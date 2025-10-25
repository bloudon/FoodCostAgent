const fs = require('fs');
const pdfParse = require('pdf-parse');

const pdfPath = process.argv[2];

fs.readFile(pdfPath, async (err, dataBuffer) => {
  if (err) {
    console.error('Error reading PDF:', err);
    process.exit(1);
  }
  
  try {
    const data = await pdfParse(dataBuffer);
    console.log(data.text);
  } catch (error) {
    console.error('Error parsing PDF:', error);
    process.exit(1);
  }
});
