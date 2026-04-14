// ─────────────────────────────────────────────────────────
//  AirportService — provides arrival/departure stats from
//  live flightService data, keyed by IATA airport code.
// ─────────────────────────────────────────────────────────

import { flightService } from './flightService.js';

class AirportService {
  /** Flights currently tracked as departing from this airport */
  getDepartures(code) {
    return flightService.flights.filter((f) => f.origin?.code === code);
  }

  /** Flights currently tracked as arriving at this airport */
  getArrivals(code) {
    return flightService.flights.filter((f) => f.destination?.code === code);
  }

  /** All tracked flights touching this airport (either end) */
  getFlightsForAirport(code) {
    return flightService.flights.filter(
      (f) => f.origin?.code === code || f.destination?.code === code
    );
  }
}

export const airportService = new AirportService();
