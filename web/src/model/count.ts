// Counts as BoxOps shows them: with a thousands separator ("2,000 boxes"),
// in the app, its messages and the command-line checks alike.

/** A number with a thousands separator: 2,000. */
export const thousands = (n: number): string => n.toLocaleString("en-US");

/** A count and the noun for it: "1 box", "2,000 boxes" (`many`, the plural, when it isn't the noun and "s"). */
export const counted = (n: number, one: string, many = `${one}s`): string => `${thousands(n)} ${n === 1 ? one : many}`;
