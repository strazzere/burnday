import * as fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { type CheerioAPI, load } from "cheerio";

function overwriteToJsonFile(filePath: string, isBurnDay: boolean) {
	const jsonData = {
		date: new Date().toUTCString(),
		allowedBurn: isBurnDay,
	};

	fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
}

function addDateToJsonFile(filePath: string, isBurnDay: boolean) {
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

		const data = {
			date: new Date().toUTCString(),
			allowedBurn: isBurnDay,
		};
		jsonData.push(data);

		fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
	}
}

const burnDayUrl = "https://itwebservices.placer.ca.gov/APCDBDI/home/";

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

axios.get(burnDayUrl).then((response) => {
	const $ = load(response.data);

	// Check for burn bans first
	if (
		$(permitInfoSelector).html()?.toLowerCase().includes(burnBan) ||
		$(permitInfoSelector).html()?.toLowerCase().includes(calFire)
	) {
		addDateToJsonFile(path.join(__dirname, "data/burnday-history.json"), false);
		overwriteToJsonFile(path.join(__dirname, "data/burnday.json"), false);
		return;
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
		throw new Error(
			"Page was not as expected: could not find today's date column.",
		);
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
	const isBurnDay = isBurnDate(
		$(burnDataSelector).html()?.trimEnd().trimStart(),
	);

	addDateToJsonFile(
		path.join(__dirname, "data/burnday-history.json"),
		isBurnDay,
	);
	overwriteToJsonFile(path.join(__dirname, "data/burnday.json"), isBurnDay);
});
