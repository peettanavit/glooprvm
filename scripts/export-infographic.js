const puppeteer = require("puppeteer");
const path = require("path");

const htmlPath = path.resolve(__dirname, "../infographic-guide.html");
const pdfPath  = path.resolve(__dirname, "../infographic-guide.pdf");
const jpgPath  = path.resolve(__dirname, "../infographic-guide.jpg");

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
    waitUntil: "networkidle0",
  });

  // wait for Google Fonts
  await new Promise((r) => setTimeout(r, 1500));

  // PDF — A4 portrait, no margins
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  console.log("✅ PDF saved:", pdfPath);

  // JPG — A4 at 150dpi (1240×1754 px)
  await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({
    path: jpgPath,
    type: "jpeg",
    quality: 95,
    fullPage: true,
  });
  console.log("✅ JPG saved:", jpgPath);

  await browser.close();
})();
