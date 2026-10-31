// Recover an uncertain response by reading its durable identity, never reposting.
export async function saveAnalysis(api, input) {
  try { return (await api('/save', input)).analysis; }
  catch (error) {
    try { const saved = await api('/analyses/' + input.id); if (saved.reportId) return saved; }
    catch { /* Keep the original save error if the status read also fails. */ }
    throw error;
  }
}
