import { expect, it } from "vitest";
import { date } from "./api";

it("diz hoje e ontem pelo calendário, e a data curta nos outros dias", () => {
  const now = new Date(2026, 10, 9, 0, 30).getTime();
  expect(date(new Date(2026, 10, 9, 0, 5).getTime(), now)).toBe("Hoje, 00:05");
  // Yesterday at 23:50 is twenty minutes ago, but still yesterday.
  expect(date(new Date(2026, 10, 8, 23, 50).getTime(), now)).toBe("Ontem, 23:50");
  expect(date(new Date(2026, 10, 7, 9, 0).getTime(), now)).toBe("07/11/2026, 09:00");
  // A clock running ahead never reads as "tomorrow".
  expect(date(new Date(2026, 10, 10, 9, 0).getTime(), now)).toBe("10/11/2026, 09:00");
});
