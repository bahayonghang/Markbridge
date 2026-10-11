fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schema = match std::env::args().nth(1).as_deref() {
        Some("wire") => schemars::schema_for!(markbridge_protocol::WireMessage),
        _ => schemars::schema_for!(markbridge_protocol::StartupState),
    };
    println!("{}", serde_json::to_string_pretty(&schema)?);
    Ok(())
}
