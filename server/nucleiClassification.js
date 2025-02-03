/**
 * @module nucleiClassification
 * @desc Used to run the nuclei classification pipeline from python code. 
 */

/**
 * Run nuclei classification pipeline.
 * @returns {Promise<Object>} A promise that resolves with the classified
 * nuclei in JSON format.
 */
function classifyNuclei(image, id) {
    console.log('Now in nuclei classification function. ');

    console.log(image);
    console.log(id);

    return new Promise(function(resolve, reject) {

        const { spawn } = require("child_process");
        const pythonProcess = spawn('python', ["./python/get_classifications.py", image, id]);

        let accumulatedData = "";
    
        pythonProcess.stdout.on("data", function(data) {
            // console.log(data.toString());
            accumulatedData += data.toString();
        });
    
        pythonProcess.stderr.on("data", (data) => {
            console.log(data.toString());
            reject(data);
        });

        pythonProcess.on("error", (err) => {
            console.error("Failed to start Python process: ", err);
            reject(err);
        });

        pythonProcess.on("close", (code) => {
            if (code == 0) {
                try {
                    const loadedJSON = JSON.parse(accumulatedData);
                    resolve(loadedJSON);
                } catch (err) {
                    console.error("Error parsing JSON: ", err);
                    reject("Error Parsing JSON")
                }
            } else {
                reject("Python process exited with error code: " + code);
            }
        });
    });
}

module.exports = function() {
    return classifyNuclei;
}