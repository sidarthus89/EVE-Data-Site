#!/usr/bin/env node
import { execSync } from "node:child_process";
import readline from "node:readline";

// Create readline interface for input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Prompt function that returns a Promise
function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

(async () => {
    try {
        let commitTitle = "";
        while (!commitTitle) {
            commitTitle = await ask("Enter commit title: ");
            if (!commitTitle) {
            }
        }

        const commitNotes = await ask("Enter commit notes (optional): ");

        rl.close();
        execSync("npm run predeploy", { stdio: "inherit" });
        execSync("gh-pages -d dist", { stdio: "inherit" });
        execSync("git checkout gh-pages", { stdio: "inherit" });
        execSync("git add .", { stdio: "inherit" });
        execSync(`git commit -m "${commitTitle}" ${commitNotes ? `-m "${commitNotes}"` : ""}`, { stdio: "inherit" });
        execSync("git push", { stdio: "inherit" });
        execSync("git checkout main", { stdio: "inherit" });
    } catch (err) {
        console.error("❌ Error during publish:", err.message);
        process.exit(1);
    }
})();
