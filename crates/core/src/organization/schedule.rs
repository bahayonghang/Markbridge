//! Assignment windows. At most two batches run at the same time.
use std::future::Future;
use std::ops::Range;

pub(crate) fn windows(total: usize, size: usize) -> Vec<Range<usize>> {
    let size = size.max(1);
    let mut out = Vec::new();
    let mut index = 0;
    while index < total {
        let end = (index + size).min(total);
        out.push(index..end);
        index = end;
    }
    out
}

pub(crate) async fn run_pair<T, E, F, Fut>(window: Range<usize>, mut run: F) -> (Vec<T>, Option<E>)
where
    F: FnMut(usize) -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut indexes = window;
    let Some(first) = indexes.next() else {
        return (Vec::new(), None);
    };
    let Some(second) = indexes.next() else {
        return match run(first).await {
            Ok(value) => (vec![value], None),
            Err(error) => (Vec::new(), Some(error)),
        };
    };
    let (left, right) = tokio::join!(run(first), run(second));
    let mut rows = Vec::new();
    let mut error = None;
    for item in [left, right] {
        match item {
            Ok(value) => rows.push(value),
            Err(err) => error = Some(err),
        }
    }
    (rows, error)
}
