export function isMockDataAllowed(
  dev = import.meta.env.DEV === true,
  configured = import.meta.env.VITE_ALLOW_MOCK_DATA,
): boolean {
  return dev || configured === "true";
}
