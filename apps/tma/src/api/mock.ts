export function isMockDataAllowed(): boolean {
  return (
    import.meta.env.DEV === true ||
    import.meta.env.VITE_ALLOW_MOCK_DATA === "true"
  );
}
