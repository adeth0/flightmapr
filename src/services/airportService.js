// ─────────────────────────────────────────────────────────
//  AirportService — provides arrival/departure stats from
//  live flightService data, keyed by IATA airport code.
// ─────────────────────────────────────────────────────────

import { flightService } from './flightService.js';
import { AIRPORTS } from './flightService.js';
import { getCachedEnrichment } from './flightEnrichmentService.js';
import { computeFlightTimes, computeFlightProgress } from './flightTimingService.js';

class AirportService {
  searchAirports(query) {
    const q = query?.trim().toLowerCase();
    if (!q) return [];

    return Object.values(AIRPORTS)
      .filter((airport) =>
        airport.code.toLowerCase().includes(q) ||
        airport.name.toLowerCase().includes(q) ||
        airport.city.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }

  getAirport(code) {
    return AIRPORTS[code] ?? null;
  }

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

  getScheduledDepartures(code) {
    return flightService.flights
      .filter((flight) => {
        const enrichment = getCachedEnrichment(flight.callsign);
        const originCode = enrichment?.origin?.code ?? flight.origin?.code;
        return originCode === code;
      })
      .map((flight) => {
        const enrichment = getCachedEnrichment(flight.callsign);
        const timing = computeFlightTimes(flight, enrichment);
        const progress = computeFlightProgress(flight, enrichment);
        const destination = enrichment?.destination ?? flight.destination;

        return {
          flight,
          enrichment,
          destination,
          scheduledDepartureMs: timing?.deptMs ?? null,
          estimatedArrivalMs: timing?.etaMs ?? null,
          delayMinutes: enrichment?.delayMinutes ?? 0,
          progress: progress?.progress ?? null,
        };
      })
      .sort((a, b) => {
        if (a.scheduledDepartureMs == null && b.scheduledDepartureMs == null) return 0;
        if (a.scheduledDepartureMs == null) return 1;
        if (b.scheduledDepartureMs == null) return -1;
        return a.scheduledDepartureMs - b.scheduledDepartureMs;
      })
      .slice(0, 8);
  }
}

export const airportService = new AirportService();
