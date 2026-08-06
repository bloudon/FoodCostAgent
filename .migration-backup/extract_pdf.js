const fs = require('fs');
const pdf = require('pdf-parse');

const pdfPath = process.argv[2];

fs.readFile(pdfPath, (err, dataBuffer) => {
  if (err) {
    console.error('Error reading PDF:', err);
    process.exit(1);
  }
  
  pdf(dataBuffer).then((data) => {
    console.log(data.text);
  }).catch((err) => {
    console.error('Error parsing PDF:', err);
    process.exit(1);
  });
});
