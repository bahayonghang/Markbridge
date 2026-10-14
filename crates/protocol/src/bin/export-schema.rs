fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schema = match std::env::args().nth(1).as_deref() {
        Some("wire") => schemars::schema_for!(markbridge_protocol::WireMessage),
        Some("bridge") => schemars::schema_for!(markbridge_protocol::BridgeState),
        Some("pairing") => schemars::schema_for!(markbridge_protocol::PairingOffer),
        Some("mirror-tree") => schemars::schema_for!(markbridge_protocol::MirrorTree),
        Some("chrome-profiles") => schemars::schema_for!(markbridge_protocol::ChromeProfileList),
        Some("library-nodes") => schemars::schema_for!(markbridge_protocol::LibraryNodes),
        Some("library-page") => schemars::schema_for!(markbridge_protocol::LibraryPage),
        Some("library-search") => schemars::schema_for!(markbridge_protocol::LibrarySearch),
        Some("library-detail") => schemars::schema_for!(markbridge_protocol::LibraryDetail),
        Some("library-count") => schemars::schema_for!(markbridge_protocol::LibraryCount),
        Some("library-query") => schemars::schema_for!(markbridge_protocol::LibraryQuery),
        Some("library-query-page") => schemars::schema_for!(markbridge_protocol::LibraryQueryPage),
        Some("batch-edit-preview") => schemars::schema_for!(markbridge_protocol::BatchEditPreview),
        Some("batch-edit-status") => schemars::schema_for!(markbridge_protocol::BatchEditStatus),
        Some("edit-preview") => schemars::schema_for!(markbridge_protocol::EditPreview),
        Some("apply-result") => schemars::schema_for!(markbridge_protocol::ApplyResult),
        Some("operation-list") => schemars::schema_for!(markbridge_protocol::OperationList),
        Some("operation-detail") => schemars::schema_for!(markbridge_protocol::OperationDetail),
        Some("undo-preview") => schemars::schema_for!(markbridge_protocol::UndoPreview),
        Some("export-save-result") => schemars::schema_for!(markbridge_protocol::ExportSaveResult),
        Some("diagnostic-report") => schemars::schema_for!(markbridge_protocol::DiagnosticReport),
        Some("diagnostic-save-result") => {
            schemars::schema_for!(markbridge_protocol::DiagnosticSaveResult)
        }
        Some("edit-document") => schemars::schema_for!(markbridge_protocol::EditDocument),
        Some("tag-catalog") => schemars::schema_for!(markbridge_protocol::TagCatalog),
        Some("title-encoding") => schemars::schema_for!(markbridge_protocol::TitleEncodingPreview),
        Some("content-preview") => schemars::schema_for!(markbridge_protocol::ContentPreview),
        Some("web-preview") => schemars::schema_for!(markbridge_protocol::WebPreviewState),
        Some("ai-settings") => schemars::schema_for!(markbridge_protocol::AiSettings),
        Some("ai-connection") => schemars::schema_for!(markbridge_protocol::AiConnection),
        Some("ai-suggestion") => schemars::schema_for!(markbridge_protocol::AiSuggestion),
        Some("ai-apply") => schemars::schema_for!(markbridge_protocol::AiApplyResult),
        Some("organization-plan") => schemars::schema_for!(markbridge_protocol::OrganizationPlan),
        Some("maintenance-report") => schemars::schema_for!(markbridge_protocol::MaintenanceReport),
        Some("semantic-settings") => schemars::schema_for!(markbridge_protocol::SemanticSettings),
        Some("semantic-config") => schemars::schema_for!(markbridge_protocol::SemanticConfig),
        Some("semantic-scope") => schemars::schema_for!(markbridge_protocol::SemanticScope),
        Some("semantic-review") => schemars::schema_for!(markbridge_protocol::SemanticScopeReview),
        Some("semantic-status") => schemars::schema_for!(markbridge_protocol::SemanticStatus),
        Some("semantic-query") => schemars::schema_for!(markbridge_protocol::SemanticQuery),
        Some("semantic-result") => schemars::schema_for!(markbridge_protocol::SemanticQueryResult),
        Some("semantic-model-check") => {
            schemars::schema_for!(markbridge_protocol::SemanticModelCheck)
        }
        Some("text-search") => schemars::schema_for!(markbridge_protocol::TextSearchPage),
        _ => schemars::schema_for!(markbridge_protocol::StartupState),
    };
    println!("{}", serde_json::to_string_pretty(&schema)?);
    Ok(())
}
