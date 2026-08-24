const { getAuthUrl, getTokens } = require('./googleCal');
const readline = require('readline');

console.log("=== Google Calendar Authentication ===");
console.log("1. Ensure you have added GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to your .env file.");
console.log("   (Set GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob for a manual copy-paste flow if using Desktop app credentials)");
console.log("2. Open the following URL in your browser to authorize Valmorain:");
console.log("\n" + getAuthUrl() + "\n");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question('Enter the authorization code from the page here: ', async (code) => {
    try {
        const tokens = await getTokens(code);
        console.log("\n✅ Authentication successful! Please add the following line to your .env file:\n");
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log("\nAfter adding it to .env, restart Valmorain so she can access your calendar!");
    } catch (error) {
        console.error("❌ Error retrieving tokens:", error.message);
    }
    rl.close();
});
