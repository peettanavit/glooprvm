const puppeteer = require("puppeteer");
const path = require("path");

const files = [
  {
    html: path.resolve(__dirname, "../qrcode-banner-v1.html"),
    pdf:  path.resolve(__dirname, "../qrcode-banner-v1.pdf"),
    label: "v1 (QR ซ้าย)",
    width: 480,
  },
  {
    html: path.resolve(__dirname, "../qrcode-banner.html"),
    pdf:  path.resolve(__dirname, "../qrcode-banner-v2.pdf"),
    label: "v2 (QR กลาง ใหญ่)",
    width: 480,
  },
];

(async () => {
  const browser = await puppeteer.launch();

  for (const f of files) {
    const page = await browser.newPage();

    // Set viewport to match card width + padding
    await page.setViewport({ width: f.width + 96, height: 800, deviceScaleFactor: 2 });

    await page.goto(`file:///${f.html.replace(/\\/g, "/")}`, { waitUntil: "networkidle0" });

    // Wait for Google Fonts + QR render
    await new Promise((r) => setTimeout(r, 2000));

    // Get actual content size
    const bodyHandle = await page.$(".banner");
    const box = await bodyHandle.boundingBox();

    await page.pdf({
      path: f.pdf,
      printBackground: true,
      width:  `${Math.ceil(box.width  + 96)}px`,
      height: `${Math.ceil(box.height + 96)}px`,
      margin: { top: "48px", right: "48px", bottom: "48px", left: "48px" },
    });

    console.log(`✅ ${f.label} → ${f.pdf}`);
    await page.close();
  }

  await browser.close();
  console.log("Done!");
})();
