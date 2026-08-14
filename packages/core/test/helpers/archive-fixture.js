const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createArchiveFixture(label = 'fixture') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dayloom-core-${label}-`));
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
    readJson(relativePath) {
      return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
    },
    writeJson(relativePath, value) {
      const filePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    },
  };
}

module.exports = { createArchiveFixture };
