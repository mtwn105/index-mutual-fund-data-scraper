const axios = require("axios").default;
const cheerio = require("cheerio");
const { format } = require("date-fns-tz");
const { subDays } = require("date-fns");
// const puppeteer = require("puppeteer");
let converter = require("json-2-csv");
const fs = require("fs");
const { tr } = require("date-fns/locale");

const benchmarks = [];

scrape = async () => {
  // Fetch all MF and their ids and write to file
  let mfList = [];

  const mfUrl = "https://www.amfiindia.com/spages/NAVOpen.txt";

  const { data } = await axios.get(mfUrl);

  const lines = data
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);

  lines.forEach((line) => {
    if (line.includes(";")) {
      const lineParts = line.split(";");
      if (lineParts.length > 5) {
        mfList.push({
          id: lineParts[0],
          name: lineParts[3],
        });
      }
    }
  });
  mfList = mfList.filter(
    (element) => element.name && element.name.includes("Direct")
  );

  console.log("MF List", mfList.length);

  const mfListData = JSON.stringify(mfList, null, 2); // null and 2 are for formatting the JSON

  // Write JSON string to a file
  fs.writeFile("amfiMF.json", mfListData, "utf8", (err) => {
    if (err) {
      console.error("Error writing file:", err);
    } else {
      console.log("File was written successfully");
    }
  });

  // Fetch Tracking Error
  let trackErrorDataFound = false;
  let date = new Date();

  let trackErrorData = null;
  let trackErrorPage = null;

  let finalDataMfList = [];

  for (let i = 0; i < 3; i++) {
    const formattedDate = format(date, "dd-MMM-yyyy");
    let trackErrorRequestData = `strMfID=-1&strType=1&strdt=${formattedDate}`;
    console.log(trackErrorRequestData);
    let config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "https://www.amfiindia.com/modules/TrackingErrorDetails",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      data: trackErrorRequestData,
    };

    const trackErrorResponse = await axios.request(config);

    trackErrorPage = cheerio.load(trackErrorResponse.data);

    // console.log(trackErrorResponse.data);

    const tables = trackErrorPage("table > tbody");

    // console.log("Tables", tables);

    if (tables.length > 1) {
      trackErrorData = tables.get(1);

      trackErrorData.childNodes.map((element, index) => {
        try {
          const name = trackErrorPage(element).find("td").get(0);
          const benchmark = trackErrorPage(element).find("td").get(1);
          const trackingError = trackErrorPage(element).find("td").get(3);

          // check name if already exists ignore
          const existingBenchmark = benchmarks.find(
            (element) => element.name === trackErrorPage(name).text()
          );

          if (!existingBenchmark) {
            finalDataMfList.push({
              name: trackErrorPage(name).text(),
              benchmark: trackErrorPage(benchmark).text(),
              trackingError: trackErrorPage(trackingError).text(),
            });
          }
        } catch (error) {
          console.log("Error", error);
        }
      });

      // console.log("Track Error Data", trackErrorData);
      trackErrorDataFound = true;
    }
    date = subDays(date, i + 1);
    // console.log("Date", date);
  }

  // console.log("Track Error Data", trackErrorData);

  console.log("MF List", finalDataMfList.length);

  finalDataMfList = finalDataMfList.filter((element) => {
    return element.name;
  });
  console.log("MF List", finalDataMfList.length);

  finalDataMfList.map((element) => {
    element.trackingError = Number(element.trackingError.split("%")[0]);
  });

  finalDataMfList.map((element) => {
    // find id in mflist
    const mf = mfList.find(
      (e) => e.name.includes(element.name) && e.name.includes("Direct")
    );
    if (mf) {
      element.id = mf.id;
    }
  });

  finalDataMfList = finalDataMfList.filter((element) => {
    return element.id;
  });

  // console.log("MF List", finalDataMfList.length);

  const monthTer = format(new Date(), "M-yyyy");
  // console.log("TER Month", monthTer);

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://www.amfiindia.com/modules/LoadTERData",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    data: `MonthTER=${monthTer}&MF_ID=-1&NAV_ID=1&SchemeCat_Desc=-1`,
  };

  const terResponse = await axios.request(config);

  const terResponsePage = cheerio.load(terResponse.data);

  const mfSchemes = terResponsePage("table > tbody > tr");

  mfSchemes.each((index, element) => {
    const mfScheme = terResponsePage(element.childNodes.at(1)).text();
    const directTer = terResponsePage(element.childNodes.at(27)).text();
    // console.log(mfScheme, directTer);
    const mf = finalDataMfList.find((e) => e.name.includes(mfScheme));
    if (mf && !!directTer && directTer > 0) {
      mf.directTer = Number(directTer);
      mf.totalFees = mf.trackingError + mf.directTer;
    }
  });

  finalDataMfList = finalDataMfList.filter((element) => {
    return !!element.totalFees;
  });

  // sort by name and benchmark
  finalDataMfList = finalDataMfList.sort((a, b) => {
    if (a.benchmark < b.benchmark) {
      return -1;
    }
    if (a.benchmark > b.benchmark) {
      return 1;
    }

    if (a.benchmark == b.benchmark) {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
    }
    return 0;
  });

  const csv = await converter.json2csv(finalDataMfList, {
    fields: [
      "id",
      "name",
      "benchmark",
      "trackingError",
      "directTer",
      "totalFees",
    ],
  });

  // Convert object to JSON string
  const jsonData = JSON.stringify(finalDataMfList, null, 2); // null and 2 are for formatting the JSON

  // Write JSON string to a file
  fs.writeFile("data.json", jsonData, "utf8", (err) => {
    if (err) {
      console.error("Error writing file:", err);
    } else {
      console.log("File was written successfully");
    }
  });

  // Write CSV string to a file
  fs.writeFile("data.csv", csv, "utf8", (err) => {
    if (err) {
      console.error("Error writing file:", err);
    } else {
      console.log("File was written successfully");
    }
  });
};

scrape();

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}
