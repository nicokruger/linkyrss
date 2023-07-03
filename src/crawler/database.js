const fs = require('fs');
class FilesystemDatabase {

  constructor(databaseDir) {
    this.databaseDir = databaseDir;
    this.files = {};

    if (!fs.existsSync(databaseDir)) {
      fs.mkdirSync(databaseDir);
    }

  }

  async getPage(url) {
    const fileName = this.getFilenameFromUrl(url, 'json');
    if (fs.existsSync(fileName)) {
      const page = fs.readFileSync(fileName, 'utf8').toString();
      return JSON.parse(page);
    } else {
      throw new Error(`Cannot find page for ${url}`);
    }
  }

  async storePage(page, url) {
    const fileName = this.getFilenameFromUrl(url, 'json');
    fs.writeFileSync(fileName, JSON.stringify(page));
  }

  async getScreenshot(url) {
    const fileName = this.getFilenameFromUrl(url, 'bin');
    if (!fs.existsSync(fileName)) {
      return null;
    }
    const screenshot = fs.readFileSync(fileName);
    return screenshot;
  }

  async storeScreenshot(screenshot, url) {
    const fileName = this.getFilenameFromUrl(url, 'bin');
    fs.writeFileSync(fileName, screenshot);
  }

  getFilenameFromUrl(url, suffix) {
    // sanitize url for filesystem
    const sanitizedUrl = url.replace(/[:\/]/g, '_');
    // base64 encode the url
    let encodedUrl = Buffer.from(sanitizedUrl).toString('base64');
    // remove non-alphanumeric characters
    encodedUrl = encodedUrl.replace(/[^a-zA-Z0-9]/g, '_');

    // limit to 240 characters
    encodedUrl = encodedUrl.substring(0, 210);

    // return the filename
    return `${this.databaseDir}/${encodedUrl}.${suffix}`;
  }

}
module.exports.FilesystemDatabase = FilesystemDatabase;
