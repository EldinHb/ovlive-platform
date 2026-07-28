//! Interactive API docs: hand-written OpenAPI served with the Scalar UI, which provides
//! a "try it with your API key" playground.

use axum::http::header;
use axum::response::{Html, IntoResponse, Response};

const OPENAPI: &str = include_str!("../openapi.json");

pub async fn openapi() -> Response {
    ([(header::CONTENT_TYPE, "application/json")], OPENAPI).into_response()
}

pub async fn scalar() -> Html<&'static str> {
    Html(
        r#"<!doctype html>
<html>
  <head>
    <title>OVLive API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>"#,
    )
}
