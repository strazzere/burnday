import * as fs from "node:fs";
import * as https from "node:https";
import path from "node:path";
import axios from "axios";
import { type CheerioAPI, load } from "cheerio";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

type BurnResult = {
	allowedBurn: boolean;
	source: "arcgis" | "legacy";
	status?: string;
	info?: string;
};

function toRecord(result: BurnResult) {
	return {
		date: new Date().toUTCString(),
		allowedBurn: result.allowedBurn,
		...(result.status !== undefined && { status: result.status }),
		...(result.info && { info: result.info }),
		source: result.source,
	};
}

function overwriteToJsonFile(filePath: string, result: BurnResult) {
	const jsonData = toRecord(result);

	fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
}

function addDateToJsonFile(filePath: string, result: BurnResult) {
	const data = fs.readFileSync(filePath, "utf-8");
	const jsonData = JSON.parse(data);

	if (Array.isArray(jsonData)) {
		const today = jsonData.filter((data) => {
			const date = new Date(data.date);
			const today = new Date();
			return (
				date.getDate() === today.getDate() &&
				date.getMonth() === today.getMonth() &&
				date.getFullYear() === today.getFullYear()
			);
		});

		if (today.length > 0) {
			return;
		}

		jsonData.push(toRecord(result));

		fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
	}
}

// Record "no burn" for every day after the last history entry up to today, for
// when the site hasn't been updated (or this job didn't run) for a while.
function backfillNoBurn(filePath: string) {
	const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	if (!Array.isArray(jsonData) || jsonData.length === 0) {
		return;
	}

	const last = new Date(jsonData[jsonData.length - 1].date);
	const day = Date.UTC(
		last.getUTCFullYear(),
		last.getUTCMonth(),
		last.getUTCDate(),
	);
	const now = new Date();
	const todayUtc = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);

	// Backfilled days are stamped mid-morning UTC, like the real runs.
	for (let d = day + 86400000; d < todayUtc; d += 86400000) {
		jsonData.push({
			date: new Date(d + 14 * 3600000).toUTCString(),
			allowedBurn: false,
		});
	}

	fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
}

const burnDayUrl = "https://itwebservices.placer.ca.gov/apcdbdi/home/";

const westernSelector = westernRowSelector(1);
const expectedWestern = "Western Placer County (West of Cisco Grove)";

const permitInfoSelector = westernRowSelector(2);

function findTodayColumnIndex($: CheerioAPI): number {
	const today = new Date();
	const months: { [key: string]: number } = {
		January: 0,
		February: 1,
		March: 2,
		April: 3,
		May: 4,
		June: 5,
		July: 6,
		August: 7,
		September: 8,
		October: 9,
		November: 10,
		December: 11,
	};

	const headerSelector =
		"body > div.container.body-content > div > table > thead > tr > th";
	let todayColumnIndex = -1;

	$(headerSelector).each((index: number, element) => {
		const headerText = $(element).text().trim();

		// Skip non-date columns
		if (headerText === "Area" || headerText === "Permit Info.") {
			return;
		}

		// Parse the date from the header (format: "Monday, January 20, 2026")
		try {
			const parts = headerText.split(", ");
			if (parts.length >= 3) {
				const dateParts = parts[1].split(" "); // ["January", "20"]
				const year = Number.parseInt(parts[2], 10);
				const month = months[dateParts[0]];
				const day = Number.parseInt(dateParts[1], 10);

				if (month !== undefined && !Number.isNaN(day) && !Number.isNaN(year)) {
					const headerDate = new Date(year, month, day);

					// Check if this date matches today
					if (
						headerDate.getDate() === today.getDate() &&
						headerDate.getMonth() === today.getMonth() &&
						headerDate.getFullYear() === today.getFullYear()
					) {
						todayColumnIndex = index + 1; // nth-child is 1-indexed
						return false; // break the loop
					}
				}
			}
		} catch (_error) {
			// Skip columns that don't parse as dates
		}
	});

	return todayColumnIndex;
}

// Latest date among the table headers, or undefined if none parse.
function latestHeaderDate($: CheerioAPI): Date | undefined {
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const headerSelector =
		"body > div.container.body-content > div > table > thead > tr > th";
	let latest: Date | undefined;

	$(headerSelector).each((_index: number, element) => {
		const parts = $(element).text().trim().split(", ");
		if (parts.length < 3) return;
		const [monthName, dayText] = parts[1].split(" ");
		const month = months.indexOf(monthName);
		const day = Number.parseInt(dayText, 10);
		const year = Number.parseInt(parts[2], 10);
		if (month === -1 || Number.isNaN(day) || Number.isNaN(year)) return;
		const date = new Date(year, month, day);
		if (!latest || date > latest) latest = date;
	});

	return latest;
}

const burnBan = "BURN BAN IN EFFECT UNTIL FURTHER NOTICE".toLowerCase();
const calFire = "CAL FIRE Permit Suspension".toLowerCase();

function westernRowSelector(column: number): string {
	return `body > div.container.body-content > div > table > tbody > tr:nth-child(1) > td:nth-child(${column})`;
}

function isToday(date: string): boolean {
	const months: { [key: string]: number } = {
		January: 0,
		February: 1,
		March: 2,
		April: 3,
		May: 4,
		June: 5,
		July: 6,
		August: 7,
		September: 8,
		October: 9,
		November: 10,
		December: 11,
	};

	const parts = date.split(", ");
	const dateParts = parts[1].split(" ");
	const year = Number.parseInt(parts[2], 10);
	const month = months[dateParts[0]];
	const day = Number.parseInt(dateParts[1], 10);

	const givenDate = new Date(year, month, day);
	const today = new Date();

	return (
		givenDate.getDate() === today.getDate() &&
		givenDate.getMonth() === today.getMonth() &&
		givenDate.getFullYear() === today.getFullYear()
	);
}

function isBurnDate(info: string | undefined) {
	if (!info) return false;

	return !info.includes("No ");
}

const headers = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// Placer County's newer "Burn Day Status" experience
// (https://experience.arcgis.com/experience/572b2af789e94b2f888c5e0c2b88a589)
// is backed by this public feature layer. The legacy site above is stale.
const featureUrl =
	"https://services9.arcgis.com/NENkjkswKTzMfG3A/arcgis/rest/services/Burn_Day_Status_Public/FeatureServer/0";
const arcgisArea = "Western Placer County";
const arcgisTimeZone = "America/Los_Angeles";

// Status codes 1-5 are burn days (with varying hours); 6, 7 and 9 are not.
function isBurnCode(code: string): boolean {
	return /^[1-5]-/.test(code);
}

function pacificDay(ms: number): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: arcgisTimeZone }).format(
		new Date(ms),
	);
}

type ArcgisAttributes = {
	statusDateToday?: number | null;
	burnStatusToday?: string | null;
	burnInfoToday?: string | null;
	statusDateTomorrow?: number | null;
	burnStatusTomorrow?: string | null;
	burnInfoTomorrow?: string | null;
};

// Pick today's status, falling back to the "tomorrow" slot when the county
// hasn't rolled over yet. Undefined means the data is stale.
function pickToday(
	attrs: ArcgisAttributes,
	now: number,
): { code: string; info: string } | undefined {
	const today = pacificDay(now);
	if (attrs.statusDateToday && pacificDay(attrs.statusDateToday) === today) {
		return {
			code: attrs.burnStatusToday ?? "",
			info: attrs.burnInfoToday ?? "",
		};
	}
	if (
		attrs.statusDateTomorrow &&
		pacificDay(attrs.statusDateTomorrow) === today
	) {
		return {
			code: attrs.burnStatusTomorrow ?? "",
			info: attrs.burnInfoTomorrow ?? "",
		};
	}
	return undefined;
}

async function fetchArcgisStatus(): Promise<BurnResult | undefined> {
	const [layer, query] = await Promise.all([
		axios.get(featureUrl, { params: { f: "json" }, headers }),
		axios.get(`${featureUrl}/query`, {
			params: {
				where: `AreaName='${arcgisArea}'`,
				outFields: "*",
				returnGeometry: false,
				f: "json",
			},
			headers,
		}),
	]);

	if (query.data.error) {
		throw new Error(`ArcGIS query failed: ${JSON.stringify(query.data.error)}`);
	}
	const attrs: ArcgisAttributes | undefined =
		query.data.features?.[0]?.attributes;
	if (!attrs) {
		throw new Error(`ArcGIS returned no row for "${arcgisArea}".`);
	}

	const picked = pickToday(attrs, Date.now());
	if (!picked) {
		console.warn("ArcGIS status dates are not current.");
		return undefined;
	}

	const field = layer.data.fields?.find(
		(f: { name: string }) => f.name === "burnStatusToday",
	);
	const status: string | undefined = field?.domain?.codedValues?.find(
		(c: { code: string }) => c.code === picked.code,
	)?.name;

	return {
		allowedBurn: isBurnCode(picked.code),
		status: status ?? picked.code,
		info: picked.info,
		source: "arcgis",
	};
}

// Returns stale=true when the legacy site is explicitly out of date.
async function scrapeLegacySite(): Promise<BurnResult & { stale?: boolean }> {
	const response = await axios.get(burnDayUrl, { httpsAgent, headers });
	const $ = load(response.data);

	// Check for burn bans first
	if (
		$(permitInfoSelector).html()?.toLowerCase().includes(burnBan) ||
		$(permitInfoSelector).html()?.toLowerCase().includes(calFire)
	) {
		return { allowedBurn: false, source: "legacy" };
	}

	// Verify we found the Western Placer row
	const westernText = $(westernSelector).html();
	if (!westernText || westernText.indexOf(expectedWestern) === -1) {
		throw new Error(
			"Page was not as expected: could not find Western Placer County row.",
		);
	}

	// Find today's date column dynamically
	const todayColumnIndex = findTodayColumnIndex($);
	if (todayColumnIndex === -1) {
		const latest = latestHeaderDate($);
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);

		// Only default to "no burn" when the site is explicitly out of date.
		// Anything else (no parseable dates, gaps) means the page changed.
		if (!latest || latest >= startOfToday) {
			throw new Error(
				"Page was not as expected: could not find today's date column.",
			);
		}

		console.warn(
			`Site not updated (latest date ${latest.toDateString()}) - defaulting to no burn.`,
		);
		return { allowedBurn: false, source: "legacy", stale: true };
	}

	// Get the date from the header to verify
	const dateSelector = `body > div.container.body-content > div > table > thead > tr > th:nth-child(${todayColumnIndex})`;
	const dateText = $(dateSelector).html();

	// Verify the date matches today
	if (!dateText || !isToday(dateText)) {
		throw new Error(
			`Page was not as expected: found date column ${todayColumnIndex} but date "${dateText}" does not match today.`,
		);
	}

	// Get burn data from today's column
	const burnDataSelector = westernRowSelector(todayColumnIndex);
	return {
		allowedBurn: isBurnDate($(burnDataSelector).html()?.trimEnd().trimStart()),
		source: "legacy",
	};
}

async function main() {
	let result: (BurnResult & { stale?: boolean }) | undefined;
	try {
		result = await fetchArcgisStatus();
	} catch (error) {
		console.warn("ArcGIS lookup failed, falling back to legacy site:", error);
	}
	if (!result) {
		result = await scrapeLegacySite();
	}

	const historyPath = path.join(__dirname, "data/burnday-history.json");
	backfillNoBurn(historyPath);
	addDateToJsonFile(historyPath, result);
	overwriteToJsonFile(path.join(__dirname, "data/burnday.json"), result);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
