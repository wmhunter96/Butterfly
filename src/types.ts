export type Split = {
  /** Actual's id for the line; demo splits and new lines have none. */
  id?: string;
  categoryId: string | null;
  amount: number;
  notes: string;
  /** Set when the line is a transfer to another account (made in Actual; Butterfly doesn't edit those). */
  transferAccountId?: string | null;
};

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  accountId: string;
  amount: number; // dollars, negative = money out
  payee: string;
  payeeId?: string | null;
  categoryId: string | null;
  notes: string;
  transferAccountId: string | null;
  startingBalance: boolean;
  cleared: boolean;
  splits?: Split[];
};

export type Account = { id: string; name: string; offBudget: boolean; closed: boolean; balance: number; institution?: string | null };
export type CategoryGroup = { id: string; name: string; isIncome: boolean; hidden: boolean };
export type Category = { id: string; name: string; groupId: string; isIncome: boolean; hidden: boolean };

export type FinanceData = {
  meta: { source: 'demo' | 'actual'; syncedAt: string; lastBankSync: string | null };
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
};

export type AccountType = 'cash' | 'credit' | 'investment' | 'retirement' | 'property' | 'vehicle' | 'mortgage' | 'loan' | 'other';

export type Property = {
  id: string;
  name: string;
  /** Categories (income and expense) that belong to this property. */
  categoryIds: string[];
  /** Off-budget accounts that track the property's market value. */
  valueAccountIds: string[];
  /** Mortgage / HELOC accounts secured by the property. */
  loanAccountIds: string[];
  /** Rentals: only the net cash flow feeds the main budget views. */
  netOnly: boolean;
};

export type Settings = {
  accountTypes: Record<string, AccountType>;
  properties: Property[];
  loanRates: Record<string, number>; // accountId -> APR percent
  accountBanks: Record<string, string>; // accountId -> bank / institution shown next to the name
};

export type Line = { tx: Transaction; categoryId: string | null; amount: number };
