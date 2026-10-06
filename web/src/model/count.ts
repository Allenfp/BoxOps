// Counts as BoxOps shows them: with a thousands separator ("2,000 boxes"),
// in the app, its messages and the command-line checks alike.

/** One format for them all: `toLocaleString` makes a new one each time, some microseconds a count, and a big timeline says thousands. */
const FORMAT = new Intl.NumberFormat("en-US");

/** A number with a thousands separator: 2,000. */
export const thousands = (n: number): string => FORMAT.format(n);

/** A count and the noun for it: "1 box", "2,000 boxes" (`many`, the plural, when it isn't the noun and "s"). */
export const counted = (n: number, one: string, many = `${one}s`): string => `${thousands(n)} ${n === 1 ? one : many}`;
