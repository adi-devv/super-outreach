export function draftWeight(draft) {
  return Math.max(1, draft.to.length + (draft.cc?.length || 0));
}

export function dedupeKey(draft) {
  const recipients = [...draft.to, ...(draft.cc || [])].map((value) => value.trim().toLowerCase()).sort();
  return `${recipients.join(',')}|${draft.subject.trim().toLowerCase()}`;
}

/** Assigns drafts without mutation. Account order is the final deterministic tie-breaker. */
export function balanceDrafts(drafts, accounts) {
  const state = accounts.filter((a) => a.healthy !== false).map((a, order) => ({ ...a, order, load: a.load || 0, drafts: a.drafts || 0 }));
  const output = new Map();
  const ordered = drafts.map((draft, index) => ({ draft, index, weight: draftWeight(draft) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const item of ordered) {
    const choices = state.filter((account) => account.maxPendingWeight == null || account.load + item.weight <= account.maxPendingWeight)
      .sort((a, b) => a.load - b.load || a.drafts - b.drafts || a.order - b.order);
    const account = choices[0];
    output.set(item.index, account?.name);
    if (account) { account.load += item.weight; account.drafts += 1; }
  }
  return drafts.map((_, index) => output.get(index));
}
