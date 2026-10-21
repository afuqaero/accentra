import type { Account } from "./contracts";

export const demoAccounts: Account[] = [
  { accNo: "110-1000", accName: "Bank Account", type: "ASSET", postable: true },
  { accNo: "300-D002", accName: "Trade Creditors", type: "LIABILITY", postable: true },
  { accNo: "400-1000", accName: "Sales Revenue", type: "REVENUE", postable: true },
  { accNo: "610-1000", accName: "Office Supplies", type: "EXPENSE", postable: true },
  { accNo: "610-2000", accName: "Utilities", type: "EXPENSE", postable: true },
  { accNo: "610-3000", accName: "Professional Fees", type: "EXPENSE", postable: true },
];

export function getAccount(accNo: string) { return demoAccounts.find((account) => account.accNo === accNo); }
