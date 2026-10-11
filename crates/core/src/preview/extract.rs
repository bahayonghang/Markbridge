use scraper::{ElementRef, Html, Node};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Extracted {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub summary_source: Option<&'static str>,
    pub image_ref: Option<String>,
    pub image_label: Option<&'static str>,
}

pub(crate) fn extract_html(html: &str) -> Extracted {
    let document = Html::parse_document(html);
    let mut title = None;
    let mut description = None;
    let mut image_ref = None;
    let mut image_label = None;
    if let Ok(meta) = scraper::Selector::parse("meta") {
        for element in document.select(&meta) {
            let content = clean(element.attr("content").unwrap_or(""), 1000);
            if content.is_empty() {
                continue;
            }
            let property = element.attr("property").unwrap_or("").trim();
            let name = element.attr("name").unwrap_or("").trim();
            if title.is_none() && eq_name(property, "og:title") {
                title = Some(clip(&content, 300));
            }
            if description.is_none()
                && (eq_name(property, "og:description") || eq_name(name, "description"))
            {
                description = Some(content.clone());
            }
            if image_ref.is_none() && eq_name(property, "og:image") {
                image_ref = Some(content.clone());
                image_label = Some("og:image");
            } else if image_ref.is_none() && eq_name(name, "twitter:image") {
                image_ref = Some(content);
                image_label = Some("twitter:image");
            }
        }
    }
    if title.is_none()
        && let Ok(selector) = scraper::Selector::parse("title")
        && let Some(element) = document.select(&selector).next()
    {
        let text = clean(&element.text().collect::<String>(), 300);
        if !text.is_empty() {
            title = Some(text);
        }
    }
    let (summary, summary_source) = if let Some(description) = description {
        (Some(description), Some("description"))
    } else {
        let excerpt = clip(&excerpt_text(&document), 1000);
        if excerpt.is_empty() {
            (None, None)
        } else {
            (Some(excerpt), Some("excerpt"))
        }
    };
    Extracted {
        title,
        summary,
        summary_source,
        image_ref,
        image_label,
    }
}

fn excerpt_text(document: &Html) -> String {
    let mut out = String::new();
    if let Ok(selector) = scraper::Selector::parse("body")
        && let Some(body) = document.select(&selector).next()
    {
        walk(body, &mut out);
    }
    out
}

fn walk(element: ElementRef<'_>, out: &mut String) {
    let name = element.value().name();
    if matches!(
        name,
        "script"
            | "style"
            | "noscript"
            | "template"
            | "textarea"
            | "input"
            | "select"
            | "option"
            | "svg"
    ) {
        return;
    }
    for child in element.children() {
        match child.value() {
            Node::Text(text) => out.push_str(text),
            Node::Element(_) => {
                if let Some(child) = ElementRef::wrap(child) {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
}

fn eq_name(value: &str, expected: &str) -> bool {
    value.eq_ignore_ascii_case(expected)
}

fn clean(value: &str, max: usize) -> String {
    clip(&value.split_whitespace().collect::<Vec<_>>().join(" "), max)
}

fn clip(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
