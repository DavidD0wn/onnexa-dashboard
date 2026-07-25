const daysArg =
  process.argv.find((arg) => arg.startsWith("--days=")) || "--days=3";
process.argv.push("--apply", "--only=shopify", daysArg);
import("./sync.mjs").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
