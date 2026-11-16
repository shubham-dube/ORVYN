//! ORVYN for Windows: a tray companion. Core logic lives in plain modules so it is testable without a desktop.
pub mod api;
pub mod app;
pub mod live;
pub mod loopback;
pub mod notify;
pub mod pkce;
pub mod store;
