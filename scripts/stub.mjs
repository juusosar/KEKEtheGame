// Placeholder for root scripts whose package does not exist yet.
// Each later task replaces its stub with the real command.
const [, , name = 'script', pending = 'a later task'] = process.argv;
console.log(`[keke] "npm run ${name}" is not implemented yet: ${pending}.`);
