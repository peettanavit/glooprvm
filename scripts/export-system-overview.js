const puppeteer = require("puppeteer");
const path = require("path");

const htmlPath = path.resolve(__dirname, "../system-overview.html");
const pdfPath  = path.resolve(__dirname, "../system-overview.pdf");

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Landscape A4: 1122 x 794 px
  await page.setViewport({ width: 1122, height: 794, deviceScaleFactor: 2 });

  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
    waitUntil: "networkidle0",
  });

  // Wait for Google Fonts
  await new Promise((r) => setTimeout(r, 2000));

  await page.pdf({
    path: pdfPath,
    width: "297mm",
    height: "210mm",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    landscape: false, // we handle landscape via CSS width/height
  });

  console.log("✅ PDF saved:", pdfPath);
  await browser.close();
})();
