import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // A vehicle on its own page. The id contains `:` (`<dataowner>:<vehicle number>`), so links
  // to it must encode the segment — see `vehiclePagePath`.
  route("vehicle/:id", "routes/vehicle.tsx"),
] satisfies RouteConfig;
