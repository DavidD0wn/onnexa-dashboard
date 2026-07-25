const positionalDays = process.argv[2];
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
if (!daysArg) {
  process.argv.push(`--days=${/^\d+$/.test(positionalDays || "") ? positionalDays : 3}`);
}
process.argv.push("--apply");
import("./sync.mjs").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
