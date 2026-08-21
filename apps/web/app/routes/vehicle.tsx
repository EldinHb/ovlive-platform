// A vehicle on its own page: everything the map's panel shows, plus a map of the vehicle and
// its route. Opened in a second tab from the panel, so the map keeps running behind it, and
// linkable on its own (`/vehicle/<id>`) — the nginx SPA fallback serves the shell for it.
//
// Data comes from the same two halves the panel uses — the 8 s REST poll and the once-per-trip
// plan — plus a single-vehicle live subscription (useVehicleLive) standing in for the stream
// the map would otherwise provide.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { RestClient, type TripStop, type VehicleDetail, type VehicleTripPlan } from "@ovlive/api-types";
import { IconBack, IconFollow, ShareButton, vehiclePagePath } from "../components/Chips";
import { VehicleMap } from "../components/VehicleMap";
import {
  UpcomingStops,
  VehicleIdentity,
  VehicleMeta,
  VehicleTelemetry,
  vehicleView,
} from "../components/VehicleInfo";
import { useNow } from "../lib/clock";
import { API_BASE, getSavedStopNumbers, getSavedThemeId } from "../lib/config";
import { I18nProvider, useI18n } from "../lib/i18n";
import { useVehicleLive } from "../lib/live";
import { DEFAULT_THEME, THEMES } from "../lib/styles";

export function meta() {
  return [{ title: "OVLive" }];
}

/** Stable empty list, so a trip-less page doesn't hand the map a new array every render. */
const NO_STOPS: TripStop[] = [];

export default function VehicleRoute() {
  return (
    <I18nProvider>
      <VehiclePage />
    </I18nProvider>
  );
}

function VehiclePage() {
  const { t, lang } = useI18n();
  const now = useNow();
  const { id = "" } = useParams();
  // The map's isolate state at the moment this page was opened; the page doesn't act on it,
  // it only hands it back so the map returns the way the user left it (see vehiclePagePath).
  const [params] = useSearchParams();
  const backTo = `/?v=${encodeURIComponent(id)}${params.get("only") === "1" ? "&only=1" : ""}`;
  const rest = useMemo(() => new RestClient(API_BASE), []);
  // The theme the map was last set to; the page has no switcher of its own.
  const theme = useMemo(() => THEMES.find((x) => x.id === getSavedThemeId()) ?? DEFAULT_THEME, []);
  // Same for the stop-numbers setting: the page has no settings menu, it follows the map's.
  const stopNumbers = useMemo(getSavedStopNumbers, []);

  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [trip, setTrip] = useState<VehicleTripPlan | null>(null);
  // The trip id the loaded plan was *asked* for; see the identical comment in routes/home.tsx
  // for why this is keyed on the reported id rather than on the two simply disagreeing.
  const [planTrip, setPlanTrip] = useState<string | null>(null);
  /** The first REST answer said this vehicle isn't running — as opposed to a trip that ended. */
  const [missing, setMissing] = useState(false);
  const [following, setFollowing] = useState(true);
  const { live, ended, status } = useVehicleLive(id);

  // Live half: position, punctuality, and the trip the vehicle is currently on.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = (initial: boolean) =>
      rest
        .vehicleDetail(id)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          setMissing(false);
        })
        // Only the first failure means "not running": once a trip has ended the endpoint 404s
        // forever, and the ended banner (from the stream) is the better thing to show then.
        .catch(() => alive && initial && setMissing(true));
    load(true);
    const timer = setInterval(() => load(false), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, rest]);

  // Schedule half: route shape + every scheduled call. Fetched once per trip — it is by far
  // the largest thing here and cannot change while the vehicle runs that trip.
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    rest
      .vehicleTrip(id, ctrl.signal)
      .then((p) => !ctrl.signal.aborted && setTrip(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, rest, planTrip]);

  useEffect(() => {
    const reported = detail?.trip_id;
    if (reported && trip && trip.trip_id !== reported && reported !== planTrip) setPlanTrip(reported);
  }, [detail?.trip_id, trip, planTrip]);

  const view = vehicleView({ id, basic: live ?? undefined, detail, trip, ended, now, t });

  // Name the tab after the trip, so several open vehicles stay tellable apart. Runs after the
  // provider's own title effect (data arrives later than mount), and again on a language change.
  const named = !!detail || !!live;
  useEffect(() => {
    if (named) document.title = `${view.line} → ${view.destination} · OVLive`;
  }, [view.line, view.destination, named, lang]);

  // Memoised on the values themselves: `view` is rebuilt on every clock tick and every live
  // frame, and a fresh object here would re-run the map's marker/camera effect each time.
  const line = view.line;
  const owner = view.op.label;
  const { lat, lon } = view;
  const mapVehicle = useMemo(
    () => (lat != null && lon != null ? { lat, lon, owner, line: line === "?" ? "" : line } : null),
    [lat, lon, owner, line],
  );
  // Same reason, for the map's stop layer: `?? []` would be a new array on every render.
  const tripStops = trip?.stops ?? NO_STOPS;

  return (
    <div className="detail-root">
      <header className="detail-bar">
        <Link className="back" to={backTo}>
          {IconBack}
          {t("detail.back")}
        </Link>
        <span className="brand">OVLive</span>
        <span className={`status-dot ${status}`} title={status} />
      </header>

      {/* The stream is the tie-breaker: a vehicle that entered between the poll and the
          snapshot is live, whatever that one 404 said. */}
      {missing && !live ? (
        <div className="detail-content">
          <div className="ended-banner">
            <div className="ended-title">⚠ {t("detail.notLive")}</div>
            <div className="ended-sub">{t("detail.notLiveSub", { id })}</div>
          </div>
        </div>
      ) : (
        <div className="detail-main">
          <div className="detail-map">
            <VehicleMap
              theme={theme}
              vehicle={mapVehicle}
              routeShape={trip?.route_shape ?? null}
              stops={tripStops}
              upcomingFrom={view.upcomingFrom}
              stopNumbers={stopNumbers}
              following={following}
              onDetach={() => setFollowing(false)}
            />
          </div>

          <div className="detail-content">
            <div className="detail-head">
              <VehicleIdentity view={view} showDelay={!ended} />
              <div className="follow-row">
                {following ? (
                  <span className="follow-chip live" title={t("follow.following")}>
                    {IconFollow}
                    <span className="chip-label">{t("follow.following")}</span>
                  </span>
                ) : (
                  <button className="follow-chip" onClick={() => setFollowing(true)} title={t("follow.follow")}>
                    {IconFollow}
                    <span className="chip-label">{t("follow.follow")}</span>
                  </button>
                )}
                {/* The page's own URL — this *is* the shareable link to this vehicle. */}
                <ShareButton url={() => `${location.origin}${vehiclePagePath(id)}`} t={t} />
              </div>
            </div>

            {ended && (
              <div className="ended-banner">
                <div className="ended-title">⚠ {t("ended.title")}</div>
                <div className="ended-sub">
                  {t("ended.sub", { veh: view.vehicleNumber || id.split(":")[1] || "" })}
                </div>
              </div>
            )}

            {view.atStop && <div className="at-stop">● {t("atStop.banner")}</div>}

            <VehicleMeta view={view} t={t} />

            <VehicleTelemetry view={view} now={now} t={t} />

            <UpcomingStops view={view} loading={!trip} numbers={stopNumbers} now={now} t={t} />
          </div>
        </div>
      )}
    </div>
  );
}
