//! Derived semantic data stays on the serial SQLite worker.
use super::{Result, Storage, storage_error};
use crate::semantic::{self, CancelFlag};
use markbridge_protocol::*;
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Config {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub model: Option<String>,
}
impl Config {
    pub(crate) fn settings(&self) -> SemanticSettings {
        SemanticSettings {
            enabled: self.enabled,
            endpoint_label: RequiredNullable(self.endpoint.clone()),
            model: RequiredNullable(self.model.clone()),
            input_recipe_version: semantic::RECIPE,
            max_input_chars: semantic::MAX_CHARS as u16,
            max_input_bytes: semantic::MAX_BYTES as u16,
        }
    }
}
#[derive(Debug, Clone)]
pub(crate) struct Target {
    pub bookmark_id: Id,
    pub title: String,
    pub summary: String,
    pub fingerprint: String,
}
#[derive(Clone)]
pub(crate) struct Review {
    pub scope: SemanticScope,
    pub config: Config,
    pub targets: Vec<Target>,
}
#[derive(Debug, Clone)]
pub(crate) struct Run {
    pub index: SemanticIndex,
    pub endpoint: String,
}

fn config(conn: &Connection) -> Result<Config> {
    conn.query_row(
        "SELECT enabled,endpoint,model FROM semantic_settings WHERE singleton=1",
        [],
        |row| {
            Ok(Config {
                enabled: row.get::<_, i64>(0)? == 1,
                endpoint: row.get(1)?,
                model: row.get(2)?,
            })
        },
    )
    .map_err(storage_error)
}
fn target(
    conn: &Connection,
    profile: &Id,
    epoch: SourceEpoch,
    bookmark: &Id,
) -> Result<Option<Target>> {
    let value = conn.query_row("SELECT b.title,COALESCE(m.summary,'') FROM bookmarks_cache b JOIN profiles p ON p.id=b.profile_id AND p.source_epoch=b.source_epoch LEFT JOIN bookmark_metadata m ON m.bookmark_id=b.bookmark_id WHERE b.profile_id=?1 AND b.source_epoch=?2 AND b.bookmark_id=?3 AND p.pairing_state='paired' AND b.deleted_at IS NULL AND b.node_kind='bookmark'",
        params![profile.as_str(),epoch.get() as i64,bookmark.as_str()], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).optional().map_err(storage_error)?;
    Ok(value.map(|(title, summary)| Target {
        bookmark_id: bookmark.clone(),
        fingerprint: semantic::fingerprint(profile, epoch, bookmark, &title, &summary),
        title,
        summary,
    }))
}
fn index(conn: &Connection, profile: &Id, epoch: SourceEpoch) -> Result<Option<Run>> {
    let row = conn.query_row("SELECT index_id,generation,phase,model,endpoint,digest,dimension,failure FROM semantic_indexes WHERE profile_id=?1 AND source_epoch=?2",
        params![profile.as_str(),epoch.get() as i64], |row| Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,Option<String>>(5)?,row.get::<_,Option<u16>>(6)?,row.get::<_,Option<String>>(7)?))).optional().map_err(storage_error)?;
    row.map(|(id,generation,phase,model,endpoint,digest,dimension,failure)| {
        let (total,ready,bytes) = conn.query_row("SELECT COUNT(*),COALESCE(SUM(state='ready'),0),COALESCE(SUM(length(vector)),0) FROM semantic_members WHERE index_id=?1", [&id], |row| Ok((row.get::<_,u16>(0)?,row.get::<_,u16>(1)?,row.get::<_,i64>(2)?))).map_err(storage_error)?;
        let phase = match phase.as_str() { "running"=>SemanticPhase::Running,"paused"=>SemanticPhase::Paused,"ready"=>SemanticPhase::Ready,"stale"=>SemanticPhase::Stale,_=>SemanticPhase::Failed };
        if total > 10_000 || ready > total { return Err(ErrorCode::StorageError); }
        let failure = failure.map(|value| serde_json::from_str::<SemanticFailure>(&value).map_err(|_|ErrorCode::StorageError)).transpose()?;
        Ok(Run { endpoint,index:SemanticIndex { index_id:Id::new(id)?,profile_id:profile.clone(),source_epoch:epoch,generation:Counter::new(generation as u64)?,phase,model,digest:RequiredNullable(digest.map(Id::new).transpose()?),dimension:RequiredNullable(dimension),total,ready,pending:total-ready,stored_bytes:Counter::new(bytes as u64)?,failure:RequiredNullable(failure),failure_message:RequiredNullable(failure.map(SemanticFailure::message)) } })
    }).transpose()
}
pub(super) fn invalidate_final_tree(
    conn: &Connection,
    profile: &Id,
    epoch: SourceEpoch,
) -> Result<()> {
    // This runs after all upserts, never on the temporary tombstones of a full snapshot.
    conn.execute("DELETE FROM semantic_members WHERE index_id IN (SELECT index_id FROM semantic_indexes WHERE profile_id=?1 AND source_epoch=?2) AND bookmark_id IN (SELECT bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND (deleted_at IS NOT NULL OR node_kind!='bookmark'))",params![profile.as_str(),epoch.get() as i64]).map_err(storage_error)?;
    Ok(())
}
fn valid_profile(conn: &Connection, profile: &Id, epoch: SourceEpoch) -> Result<()> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1 AND source_epoch=?2 AND pairing_state='paired')",params![profile.as_str(),epoch.get() as i64], |row|row.get(0)).map_err(storage_error)?;
    if !exists {
        return Err(ErrorCode::WrongProfile);
    }
    Ok(())
}
fn resolve(conn: &Connection, scope: &SemanticScope) -> Result<Vec<Target>> {
    valid_profile(conn, &scope.profile_id, scope.source_epoch)?;
    let revision: Option<i64> = conn
        .query_row(
            "SELECT revision FROM source_cursors WHERE profile_id=?1 AND source_epoch=?2",
            params![scope.profile_id.as_str(), scope.source_epoch.get() as i64],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    if revision != Some(scope.expected_revision.get() as i64) {
        return Err(ErrorCode::Conflict);
    }
    if scope.folder_id.0.is_some() == !scope.selected_chrome_ids.is_empty()
        || scope.selected_chrome_ids.len() > 10_000
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut statement = conn.prepare("SELECT chrome_id,bookmark_id,parent_id,node_kind FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND deleted_at IS NULL").map_err(storage_error)?;
    let rows = statement
        .query_map(
            params![scope.profile_id.as_str(), scope.source_epoch.get() as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(storage_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    let by_id: HashMap<_, _> = rows.iter().map(|row| (&row.0, row)).collect();
    let mut selected = HashSet::new();
    if let Some(folder) = &scope.folder_id.0 {
        if !by_id
            .get(&folder.as_str().to_owned())
            .is_some_and(|row| row.3 == "folder")
        {
            return Err(ErrorCode::InvalidMessage);
        }
        let mut descendants = HashSet::from([folder.as_str().to_owned()]);
        loop {
            let before = descendants.len();
            for (id, _, parent, _) in &rows {
                if parent.as_ref().is_some_and(|p| descendants.contains(p)) {
                    descendants.insert(id.clone());
                }
            }
            if descendants.len() == before {
                break;
            }
        }
        for (id, bookmark, _, kind) in &rows {
            if kind == "bookmark" && descendants.contains(id) {
                selected.insert(bookmark.clone());
            }
        }
    } else {
        for id in &scope.selected_chrome_ids {
            let row = by_id
                .get(&id.as_str().to_owned())
                .ok_or(ErrorCode::InvalidMessage)?;
            if row.3 != "bookmark" || !selected.insert(row.1.clone()) {
                return Err(ErrorCode::InvalidMessage);
            }
        }
    }
    if selected.is_empty() || selected.len() > 10_000 {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut ids: Vec<_> = selected.into_iter().collect();
    ids.sort();
    ids.into_iter()
        .map(|id| {
            target(conn, &scope.profile_id, scope.source_epoch, &Id::new(id)?)?
                .ok_or(ErrorCode::Conflict)
        })
        .collect()
}
impl Storage {
    pub(crate) async fn semantic_config(&self) -> Result<Config> {
        self.call(|conn| config(conn)).await
    }
    pub(crate) async fn semantic_restart(&self) -> Result<()> {
        self.call(|conn| { conn.execute("UPDATE semantic_indexes SET generation=generation+1,phase='paused' WHERE phase='running'",[]).map_err(storage_error)?; Ok(()) }).await
    }
    pub(crate) async fn semantic_save_config(&self, value: Config) -> Result<()> {
        self.call(move |conn| {
            let tx=conn.transaction().map_err(storage_error)?; let old=config(&tx)?;
            if old != value {
                let stale=old.endpoint!=value.endpoint || old.model!=value.model;
                tx.execute("UPDATE semantic_indexes SET generation=generation+1,phase=CASE WHEN phase='stale' OR ?1 THEN 'stale' ELSE 'paused' END",[stale]).map_err(storage_error)?;
                tx.execute("UPDATE semantic_settings SET enabled=?1,endpoint=?2,model=?3 WHERE singleton=1",params![value.enabled,value.endpoint,value.model]).map_err(storage_error)?;
            }
            tx.commit().map_err(storage_error)
        }).await
    }
    pub(crate) async fn semantic_status(
        &self,
        profile: Id,
        epoch: SourceEpoch,
    ) -> Result<SemanticStatus> {
        self.call(move |conn| {
            valid_profile(conn, &profile, epoch)?;
            Ok(SemanticStatus {
                settings: config(conn)?.settings(),
                index: RequiredNullable(index(conn, &profile, epoch)?.map(|run| run.index)),
            })
        })
        .await
    }
    pub(crate) async fn semantic_review(&self, scope: SemanticScope) -> Result<Review> {
        self.call(move |conn| {
            let config = config(conn)?;
            if !config.enabled || config.endpoint.is_none() || config.model.is_none() {
                return Err(ErrorCode::InvalidMessage);
            }
            let targets = resolve(conn, &scope)?;
            Ok(Review {
                scope,
                config,
                targets,
            })
        })
        .await
    }
    pub(crate) async fn semantic_start(&self, review: Review, id: Id) -> Result<Run> {
        self.call(move |conn| {
            let tx=conn.transaction().map_err(storage_error)?;
            if config(&tx)? != review.config {return Err(ErrorCode::Conflict);}
            let targets=resolve(&tx,&review.scope)?;
            if targets.iter().map(|t|&t.fingerprint).ne(review.targets.iter().map(|t|&t.fingerprint)) {return Err(ErrorCode::Conflict);}
            tx.execute("DELETE FROM semantic_indexes WHERE profile_id=?1",[review.scope.profile_id.as_str()]).map_err(storage_error)?;
            tx.execute("INSERT INTO semantic_indexes(index_id,profile_id,source_epoch,generation,phase,model,endpoint,recipe) VALUES(?1,?2,?3,1,'running',?4,?5,1)",params![id.as_str(),review.scope.profile_id.as_str(),review.scope.source_epoch.get() as i64,review.config.model,review.config.endpoint]).map_err(storage_error)?;
            {let mut statement=tx.prepare("INSERT INTO semantic_members(index_id,bookmark_id,state) VALUES(?1,?2,'pending')").map_err(storage_error)?;for target in targets {statement.execute(params![id.as_str(),target.bookmark_id.as_str()]).map_err(storage_error)?;}}
            let run=index(&tx,&review.scope.profile_id,review.scope.source_epoch)?.ok_or(ErrorCode::StorageError)?;
            tx.commit().map_err(storage_error)?;Ok(run)
        }).await
    }
    pub(crate) async fn semantic_transition(
        &self,
        profile: Id,
        epoch: SourceEpoch,
        action: &'static str,
    ) -> Result<Option<Run>> {
        self.call(move |conn| {
            let tx=conn.transaction().map_err(storage_error)?;valid_profile(&tx,&profile,epoch)?;
            let current=index(&tx,&profile,epoch)?;
            if let Some(run)=&current {
                if action=="resume" {
                    let config=config(&tx)?;
                    if !config.enabled || config.endpoint.as_deref()!=Some(&run.endpoint) || config.model.as_deref()!=Some(&run.index.model) || matches!(run.index.phase,SemanticPhase::Stale|SemanticPhase::Running) {return Err(ErrorCode::Conflict);}
                }
                tx.execute("UPDATE semantic_indexes SET generation=generation+1,phase=CASE WHEN phase='stale' THEN 'stale' ELSE ?2 END,failure=CASE WHEN phase='stale' THEN failure ELSE NULL END WHERE index_id=?1",params![run.index.index_id.as_str(),if action=="resume" {"running"} else {"paused"}]).map_err(storage_error)?;
                if action=="delete" {tx.execute("DELETE FROM semantic_indexes WHERE index_id=?1",[run.index.index_id.as_str()]).map_err(storage_error)?;}
            }
            let run=index(&tx,&profile,epoch)?;tx.commit().map_err(storage_error)?;Ok(run)
        }).await
    }
    pub(crate) async fn semantic_pause_all(&self) -> Result<()> {
        self.call(|conn| {conn.execute("UPDATE semantic_indexes SET generation=generation+1,phase='paused' WHERE phase='running'",[]).map_err(storage_error)?;Ok(())}).await
    }
    pub(crate) async fn semantic_run(
        &self,
        profile: Id,
        epoch: SourceEpoch,
    ) -> Result<Option<Run>> {
        self.call(move |conn| {
            valid_profile(conn, &profile, epoch)?;
            index(conn, &profile, epoch)
        })
        .await
    }
    pub(crate) async fn semantic_bind_model(
        &self,
        run: Run,
        digest: String,
        dimension: Option<u16>,
    ) -> Result<bool> {
        self.call(move |conn| {
            let current=index(conn,&run.index.profile_id,run.index.source_epoch)?;let Some(current)=current else {return Ok(false);};
            if !same_running(&current,&run) {return Ok(false);}
            if current.index.digest.0.as_ref().is_some_and(|old|old.as_str()!=digest) || current.index.dimension.0.zip(dimension).is_some_and(|(a,b)|a!=b) {return Err(ErrorCode::Conflict);}
            conn.execute("UPDATE semantic_indexes SET digest=?2,dimension=COALESCE(dimension,?3) WHERE index_id=?1",params![run.index.index_id.as_str(),digest,dimension]).map_err(storage_error)?;Ok(true)
        }).await
    }
    pub(crate) async fn semantic_next(&self, run: Run) -> Result<Option<Target>> {
        self.call(move |conn| {
            let Some(current)=index(conn,&run.index.profile_id,run.index.source_epoch)? else {return Ok(None);}; if !same_running(&current,&run) {return Ok(None);}
            valid_profile(conn,&run.index.profile_id,run.index.source_epoch)?;
            let bookmark:Option<String>=conn.query_row("SELECT m.bookmark_id FROM semantic_members m JOIN bookmarks_cache b ON b.bookmark_id=m.bookmark_id WHERE m.index_id=?1 AND m.state='pending' AND b.deleted_at IS NULL AND b.node_kind='bookmark' ORDER BY m.bookmark_id LIMIT 1",[run.index.index_id.as_str()],|row|row.get(0)).optional().map_err(storage_error)?;
            bookmark.map(|id|target(conn,&run.index.profile_id,run.index.source_epoch,&Id::new(id)?)).transpose().map(Option::flatten)
        }).await
    }
    pub(crate) async fn semantic_commit(
        &self,
        run: Run,
        value: Target,
        digest: String,
        vector: Vec<f32>,
    ) -> Result<bool> {
        self.call(move |conn| {
            let tx=conn.transaction().map_err(storage_error)?;let Some(current)=index(&tx,&run.index.profile_id,run.index.source_epoch)? else {return Ok(false);};
            if !same_running(&current,&run) || current.index.digest.0.as_ref().map(Id::as_str)!=Some(&digest) {return Ok(false);}
            let Some(actual)=target(&tx,&run.index.profile_id,run.index.source_epoch,&value.bookmark_id)? else {return Ok(false);};
            if actual.fingerprint!=value.fingerprint {return Ok(false);}
            let dimension=vector.len() as u16;
            if current.index.dimension.0.is_some_and(|old|old!=dimension) {return Err(ErrorCode::Conflict);}
            let bytes=semantic::encode(&vector); semantic::decode(&bytes,dimension as usize).map_err(|_|ErrorCode::InvalidMessage)?;
            tx.execute("UPDATE semantic_indexes SET dimension=?2 WHERE index_id=?1",params![run.index.index_id.as_str(),dimension]).map_err(storage_error)?;
            let changed=tx.execute("UPDATE semantic_members SET state='ready',fingerprint=?3,vector=?4 WHERE index_id=?1 AND bookmark_id=?2 AND state='pending'",params![run.index.index_id.as_str(),value.bookmark_id.as_str(),value.fingerprint,bytes]).map_err(storage_error)?;
            tx.commit().map_err(storage_error)?;Ok(changed==1)
        }).await
    }
    pub(crate) async fn semantic_finish(
        &self,
        run: Run,
        failure: Option<SemanticFailure>,
    ) -> Result<()> {
        self.call(move |conn| {
            let Some(current) = index(conn, &run.index.profile_id, run.index.source_epoch)? else {
                return Ok(());
            };
            if !same_running(&current, &run) {
                return Ok(());
            }
            let phase = if matches!(
                failure,
                Some(SemanticFailure::ModelChanged | SemanticFailure::DimensionMismatch)
            ) {
                "stale"
            } else if failure.is_some() {
                "failed"
            } else if current.index.pending == 0 {
                "ready"
            } else {
                "paused"
            };
            conn.execute(
                "UPDATE semantic_indexes SET phase=?2,failure=?3 WHERE index_id=?1",
                params![
                    run.index.index_id.as_str(),
                    phase,
                    failure.map(|f| serde_json::to_string(&f).expect("enum"))
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }
    pub(crate) async fn semantic_mark_stale(
        &self,
        query: SemanticQuery,
        failure: SemanticFailure,
    ) -> Result<bool> {
        self.call(move |conn| {
            let changed=conn.execute("UPDATE semantic_indexes SET generation=generation+1,phase='stale',failure=?5 WHERE index_id=?1 AND profile_id=?2 AND source_epoch=?3 AND generation=?4",params![query.index_id.as_str(),query.profile_id.as_str(),query.source_epoch.get() as i64,query.generation.get() as i64,serde_json::to_string(&failure).expect("enum")]).map_err(storage_error)?;
            Ok(changed==1)
        }).await
    }
    pub(crate) async fn semantic_search(
        &self,
        query: SemanticQuery,
        vector: Vec<f32>,
        cancel: CancelFlag,
    ) -> Result<Vec<SemanticHit>> {
        self.call(move |conn| {
            let config=config(conn)?;if !config.enabled {return Err(ErrorCode::Conflict);}
            let current=index(conn,&query.profile_id,query.source_epoch)?.ok_or(ErrorCode::Conflict)?;
            if config.endpoint.as_deref()!=Some(&current.endpoint) || config.model.as_deref()!=Some(&current.index.model) || current.index.index_id!=query.index_id || current.index.generation!=query.generation || current.index.phase==SemanticPhase::Stale || current.index.dimension.0!=Some(vector.len() as u16) {return Err(ErrorCode::Conflict);}
            valid_profile(conn,&query.profile_id,query.source_epoch)?;
            let mut statement=conn.prepare("SELECT m.bookmark_id,b.chrome_id,b.title,COALESCE(d.summary,''),m.fingerprint,length(m.vector),substr(m.vector,1,16385) FROM semantic_members m JOIN bookmarks_cache b ON b.bookmark_id=m.bookmark_id LEFT JOIN bookmark_metadata d ON d.bookmark_id=b.bookmark_id WHERE m.index_id=?1 AND m.state='ready' AND b.profile_id=?2 AND b.source_epoch=?3 AND b.deleted_at IS NULL AND b.node_kind='bookmark' ORDER BY m.bookmark_id LIMIT 10001").map_err(storage_error)?;
            let mut rows=statement.query(params![query.index_id.as_str(),query.profile_id.as_str(),query.source_epoch.get() as i64]).map_err(storage_error)?;let mut hits=Vec::new();let mut seen=0;
            while let Some(row)=rows.next().map_err(storage_error)? {
                seen+=1;if seen>10_000 || cancel.is_cancelled() {return Err(ErrorCode::Conflict);}
                let bookmark=Id::new(row.get::<_,String>(0).map_err(storage_error)?)?;let chrome=Id::new(row.get::<_,String>(1).map_err(storage_error)?)?;let title:String=row.get(2).map_err(storage_error)?;let summary:String=row.get(3).map_err(storage_error)?;Title::new(title.clone()).map_err(|_|ErrorCode::StorageError)?;
                let fingerprint:String=row.get(4).map_err(storage_error)?;
                if fingerprint!=semantic::fingerprint(&query.profile_id,query.source_epoch,&bookmark,&title,&summary) {continue;}
                let stored_length:i64=row.get(5).map_err(storage_error)?;if stored_length!=(vector.len()*4) as i64 {return Err(ErrorCode::InvalidMessage);}
                let bytes:Vec<u8>=row.get(6).map_err(storage_error)?;let values=semantic::decode(&bytes,vector.len()).map_err(|_|ErrorCode::InvalidMessage)?;
                let score=values.iter().zip(&vector).map(|(a,b)|f64::from(*a)*f64::from(*b)).sum::<f64>().clamp(-1.0,1.0);
                hits.push(SemanticHit { bookmark_id:bookmark,chrome_id:chrome,title,score });
                hits.sort_by(|a,b|b.score.total_cmp(&a.score).then_with(||a.bookmark_id.as_str().cmp(b.bookmark_id.as_str())));hits.truncate(query.top_k as usize);
            }
            if cancel.is_cancelled() {return Err(ErrorCode::Conflict);}Ok(hits)
        }).await
    }
}
fn same_running(a: &Run, b: &Run) -> bool {
    a.index.index_id == b.index.index_id
        && a.index.generation == b.index.generation
        && a.index.phase == SemanticPhase::Running
}

#[cfg(test)]
mod tests;
