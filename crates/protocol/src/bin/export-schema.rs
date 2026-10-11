fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schema = match std::env::args().nth(1).as_deref() {
        Some("wire") => schemars::schema_for!(markbridge_protocol::WireMessage),
        Some("bridge") => schemars::schema_for!(markbridge_protocol::BridgeState),
        Some("pairing") => schemars::schema_for!(markbridge_protocol::PairingOffer),
        Some("mirror-tree") => schemars::schema_for!(markbridge_protocol::MirrorTree),
        Some("chrome-profiles") => schemars::schema_for!(markbridge_protocol::ChromeProfileList),
        _ => schemars::schema_for!(markbridge_protocol::StartupState),
    };
    println!("{}", serde_json::to_string_pretty(&schema)?);
    Ok(())
}
