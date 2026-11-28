//! A workspace icon is a small image stored on the workspace as a data URL. The browser converts what you upload to
//! WebP (or PNG, where the browser cannot encode WebP) at 256px, so the server only has to check that it really is
//! one of those two formats and small. Nothing else is accepted, so an icon can never be an SVG or other script-bearing file.

use base64::{Engine, engine::general_purpose::STANDARD};

/// Largest decoded image. A 256px WebP is usually 10 to 30 KB.
const MAX_BYTES: usize = 64 * 1024;

/// True when `value` is `data:image/webp;base64,...` or `data:image/png;base64,...` holding a matching, small image.
pub(super) fn is_valid(value: &str) -> bool {
    let Some((mime, data)) = value.strip_prefix("data:").and_then(|rest| rest.split_once(";base64,")) else {
        return false;
    };
    let Ok(bytes) = STANDARD.decode(data) else { return false };
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return false;
    }
    match mime {
        "image/webp" => bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(mime: &str, bytes: &[u8]) -> String {
        format!("data:{mime};base64,{}", STANDARD.encode(bytes))
    }

    #[test]
    fn accepts_a_real_webp_and_png() {
        let mut webp = b"RIFF\x10\x00\x00\x00WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 8]);
        assert!(is_valid(&url("image/webp", &webp)));
        assert!(is_valid(&url("image/png", &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0])));
    }

    #[test]
    fn rejects_other_types_wrong_labels_and_oversize() {
        assert!(!is_valid(&url("image/svg+xml", b"<svg onload=alert(1)/>")));
        assert!(!is_valid(&url("image/webp", b"<svg/>"))); // labelled WebP but not one
        assert!(!is_valid(&url("image/png", b"RIFF....WEBPxxxx"))); // a WebP labelled PNG
        assert!(!is_valid(&url("image/png", &vec![0x89; MAX_BYTES + 1])));
        assert!(!is_valid("data:image/webp;base64,@@@"));
        assert!(!is_valid("https://example.com/icon.webp"));
    }
}
