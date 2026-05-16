const puppeteer = require("puppeteer");
const path = require("path");

const htmlPath = path.resolve(__dirname, "../dev-guide.html");
const pdfPath  = path.resolve(__dirname, "../dev-guide.pdf");

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
    waitUntil: "networkidle0",
  });

  // Wait for Google Fonts
  await new Promise((r) => setTimeout(r, 2500));

  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  console.log("✅ PDF saved:", pdfPath);
  await browser.close();
})();
