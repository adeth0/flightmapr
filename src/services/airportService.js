// ─────────────────────────────────────────────────────────
//  AirportService — provides arrival/departure stats from
//  live flightService data, keyed by IATA airport code.
// ─────────────────────────────────────────────────────────

import { flightService } from './flightService.js';
import { AIRPORTS } from './flightService.js';
import { getCachedEnrichment } from './flightEnrichmentService.js';
import { computeFlightTimes, computeFlightProgress } from './flightTimingService.js';

const MAJOR_AIRPORT_FALLBACKS = {
  LHR: ['JFK', 'CDG', 'AMS', 'FRA', 'MAD', 'DUB', 'DXB', 'MAN'],
  JFK: ['LAX', 'LHR', 'ORD', 'MIA', 'SFO', 'ATL', 'BOS', 'DFW'],
  LAX: ['JFK', 'SFO', 'SEA', 'DEN', 'ORD', 'DFW', 'MEX', 'NRT'],
  CDG: ['LHR', 'AMS', 'FRA', 'MAD', 'BCN', 'FCO', 'DUB', 'JFK'],
  AMS: ['LHR', 'CDG', 'FRA', 'BCN', 'MAD', 'DUB', 'JFK', 'CPH'],
  DXB: ['LHR', 'DOH', 'BOM', 'DEL', 'SIN', 'JFK', 'FRA', 'SYD'],
  SIN: ['HKG', 'BKK', 'KUL', 'SYD', 'MEL', 'DXB', 'NRT', 'DEL'],
};

const AIRLINE_PREFIX = {
  GB: ['BA', 'VS', 'U2'],
  US: ['AA', 'DL', 'UA'],
  FR: ['AF', 'TO', 'V7'],
  DE: ['LH', 'EW', 'DE'],
  NL: ['KL', 'HV', 'OR'],
  AE: ['EK', 'FZ', 'EY'],
  SG: ['SQ', 'TR', '3K'],
  ES: ['IB', 'VY', 'UX'],
  IT: ['AZ', 'FR', 'U2'],
};

function hashCode(value) {
  return [...value].reduce((acc, char) => ((acc * 33) + char.charCodeAt(0)) >>> 0, 5381);
}

function buildFlightNumber(origin, destination, index) {
  const pool = AIRLINE_PREFIX[origin.country] ?? ['FM', 'SK', 'AR'];
  const prefix = pool[index % pool.length];
  const number = 100 + ((hashCode(`${origin.code}:${destination.code}:${index}`) % 800) + index);
  return `${prefix}${number}`;
}

function buildFallbackTime(originCode, destinationCode, index) {
  const now = new Date();
  const rounded = new Date(now);
  rounded.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  const offsetMinutes = 35 + (index * 55) + (hashCode(`${originCode}:${destinationCode}`) % 18);
  return rounded.getTime() + offsetMinutes * 60_000;
}

function buildFallbackDelay(originCode, destinationCode, index) {
  const seed = hashCode(`${originCode}:${destinationCode}:${index}`) % 10;
  if (seed < 6) return 0;
  if (seed < 8) return 10;
  if (seed < 9) return 20;
  return 35;
}

function buildFallbackDestinations(code) {
  const configured = MAJOR_AIRPORT_FALLBACKS[code];
  if (configured?.length) return configured;

  const origin = AIRPORTS[code];
  if (!origin) return [];

  return Object.values(AIRPORTS)
    .filter((airport) => airport.code !== code && airport.country === origin.country)
    .slice(0, 6)
    .map((airport) => airport.code);
}

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
    const liveDepartures = flightService.flights
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
      });

    if (liveDepartures.length >= 4) {
      return liveDepartures.slice(0, 8);
    }

    const airport = AIRPORTS[code];
    if (!airport) return liveDepartures.slice(0, 8);

    const seenDestinations = new Set(liveDepartures.map((item) => item.destination?.code).filter(Boolean));
    const fallbackItems = buildFallbackDestinations(code)
      .filter((destinationCode) => !seenDestinations.has(destinationCode) && AIRPORTS[destinationCode])
      .slice(0, 8 - liveDepartures.length)
      .map((destinationCode, index) => {
        const destination = AIRPORTS[destinationCode];
        return {
          id: `fallback:${code}:${destinationCode}:${index}`,
          flight: null,
          destination,
          scheduledDepartureMs: buildFallbackTime(code, destinationCode, index),
          estimatedArrivalMs: null,
          delayMinutes: buildFallbackDelay(code, destinationCode, index),
          progress: null,
          isFallback: true,
          flightNumber: buildFlightNumber(airport, destination, index),
        };
      });

    return [...liveDepartures, ...fallbackItems].slice(0, 8);
  }
}

export const airportService = new AirportService();
