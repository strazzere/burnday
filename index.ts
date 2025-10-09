import * as fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { load } from "cheerio";

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

const _westernTable =
	"body > div.container.body-content > div > table > tbody > tr:nth-child(1) > td:nth-child(1)";

const westernSelector = westernRowSelector(1);
const expectedWestern = "Western Placer County (West of Cisco Grove)";

const permitInfoSelector = westernRowSelector(2);

const dateSelector =
	"body > div.container.body-content > div > table > thead > tr > th:nth-child(4)";
const burnDataSelector = westernRowSelector(4);

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

function expected(western: string | null, date: string | null): boolean {
	if (!western || !date) return false;

	if (western.indexOf(expectedWestern) === -1) return false;

	return isToday(date);
}

function isBurnDate(info: string | undefined) {
	if (!info) return false;

	return !info.includes("No ");
}

axios.get(burnDayUrl).then((response) => {
	const $ = load(response.data);

	if (
		$(permitInfoSelector).html()?.toLowerCase().includes(burnBan) ||
		$(permitInfoSelector).html()?.toLowerCase().includes(calFire)
	) {
		addDateToJsonFile(path.join(__dirname, "data/burnday-history.json"), false);
		overwriteToJsonFile(path.join(__dirname, "data/burnday.json"), false);
		return;
	}

	if (!expected($(westernSelector).html(), $(dateSelector).html())) {
		throw new Error(
			"Page was not as expected, likely need to adjust selectors.",
		);
	}

	const isBurnDay = isBurnDate(
		$(burnDataSelector).html()?.trimEnd().trimStart(),
	);

	addDateToJsonFile(
		path.join(__dirname, "data/burnday-history.json"),
		isBurnDay,
	);
	overwriteToJsonFile(path.join(__dirname, "data/burnday.json"), isBurnDay);
});
