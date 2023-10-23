import axios from 'axios';
import { load } from 'cheerio';
import path from 'path';
import * as fs from 'fs';

function addDateToJsonFile(filePath: string, isBurnDay: boolean) {
  const data = fs.readFileSync(filePath, 'utf-8');
  const jsonData = JSON.parse(data);

  if (Array.isArray(jsonData)) {

    const data = {
      date: new Date().toUTCString(),
      allowedBurn: isBurnDay
    };
    jsonData.push(data);

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

  }
};

const burnDayUrl = 'https://itwebservices.placer.ca.gov/APCDBDI/home/'

const westernSelector = 'zbody > div.container.body-content > div > table > tbody > tr:nth-child(1) > td:nth-child(1)';
const expectedWestern = 'Western Placer County (West of Cisco Grove)';

const dateSelector = 'body > div.container.body-content > div > table > thead > tr > th:nth-child(3)';
const burnDataSelector = 'body > div.container.body-content > div > table > tbody > tr:nth-child(1) > td:nth-child(3)';

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
  const year = parseInt(parts[2]);
  const month = months[dateParts[0]];
  const day = parseInt(dateParts[1]);
  
  const givenDate = new Date(year, month, day);
  const today = new Date();

  return (
    givenDate.getDate() === today.getDate() &&
    givenDate.getMonth() === today.getMonth() &&
    givenDate.getFullYear() === today.getFullYear()
  );
}

function expected(western: string | null, date: string | null): boolean {
  if (!western || !date)
    return false;

  if (western.indexOf(expectedWestern) === -1)
    return false;

  return isToday(date);
}

function isBurnDate(info: string | undefined) {
  if (!info)
    return false

  return !info.includes('No ')
}

axios.get(burnDayUrl)
  .then((response) => {
    const $ = load(response.data)
    
    if (!expected($(westernSelector).html(), $(dateSelector).html())) {
      console.log(`Page was not as expected, likely need to adjust selectors.`)
    }
  
    const isBurnDay = isBurnDate($(burnDataSelector).html()?.trimEnd().trimStart())

    addDateToJsonFile(path.join(__dirname, 'history/burnday.json'), isBurnDay);
  })
