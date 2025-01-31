/**
 * @module nucleiDetection
 * @desc Used to run the nuclei detection pipeline from python code. 
 */

/**
 * Run nuclei detection pipeline.
 * @returns {Promise<Object>} A promise that resolves with the detected
 * nuclei in JSON format.
 */
function detectNuclei(image) {
    console.log('Now in nuclei detection function. ')

    // const imageID = "055 - 2019-02-27 15.08.57_x40"
    console.log(image.toString())

    return new Promise(function(resolve, reject) {

        const { spawn } = require("child_process");
        const pythonProcess = spawn('python', ["./python/get_nuclei.py", image]);

        let accumulatedData = "";
    
        pythonProcess.stdout.on("data", function(data) {
            accumulatedData += data.toString();
        });
    
        pythonProcess.stderr.on("data", (data) => {
            console.log(data.toString())
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
    return detectNuclei;
}