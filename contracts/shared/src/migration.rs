//! Explicit, version-checked migrations for a contract's instance storage.
//!
//! Each contract owns its key and step bodies. This module validates the
//! requested range and commits a version after each successfully executed step.
use soroban_sdk::{Env, TryFromVal, Val};

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MigrationError {
    /// The caller's expected version differs from storage.
    VersionMismatch,
    /// Target is below the source, above this WASM's version, or uninitialized.
    InvalidTarget,
    /// A step had no implementation (or the version counter overflowed).
    MissingStep,
}

impl From<MigrationError> for crate::errors::KoraError {
    fn from(_: MigrationError) -> Self {
        Self::InvalidParameterValue
    }
}

/// Read the stored schema version. Missing keys represent legacy version zero.
pub fn read_version(env: &Env, version_key: &Val) -> u32 {
    env.storage().instance().get(version_key).unwrap_or(0)
}

/// Read a storage value only when it has the codec expected by this WASM.
/// Use a version-specific legacy type inside an explicit migration step instead.
pub fn read_current<T: TryFromVal<Env, Val>>(
    env: &Env,
    version_key: &Val,
    value_key: &Val,
    expected: u32,
) -> Result<Option<T>, MigrationError> {
    if read_version(env, version_key) != expected {
        return Err(MigrationError::VersionMismatch);
    }
    Ok(env.storage().instance().get(value_key))
}

/// Execute every adjacent step in `[from_version, to_version)`.
///
/// `step(old, new)` must perform exactly one schema transition. It must reject
/// unknown transitions. A repeated call at the target returns `Ok(false)`.
/// An incorrect source version fails before any step runs. No upgrade invokes
/// this automatically: a contract entrypoint must authenticate and call it.
pub fn migrate<E, F>(
    env: &Env,
    version_key: &Val,
    from_version: u32,
    to_version: u32,
    latest_version: u32,
    mut step: F,
) -> Result<bool, E>
where
    E: From<MigrationError>,
    F: FnMut(u32, u32) -> Result<(), E>,
{
    let stored = read_version(env, version_key);
    if to_version == 0 || to_version > latest_version || from_version > to_version {
        return Err(MigrationError::InvalidTarget.into());
    }
    if stored == to_version {
        return Ok(false);
    }
    if stored != from_version {
        return Err(MigrationError::VersionMismatch.into());
    }
    let mut current = stored;
    while current < to_version {
        let next = current.checked_add(1).ok_or(MigrationError::MissingStep)?;
        step(current, next)?;
        env.storage().instance().set(version_key, &next);
        current = next;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{symbol_short, IntoVal};

    #[test]
    fn multi_step_and_idempotent_recall() {
        let env = Env::default();
        let contract = env.register_contract(None, TestContract);
        env.as_contract(&contract, || {
            let key: Val = symbol_short!("version").into_val(&env);
            let mut steps = soroban_sdk::Vec::new(&env);
            let changed = migrate::<MigrationError, _>(&env, &key, 0, 3, 3, |from, to| {
                steps.push_back((from, to));
                Ok(())
            })
            .unwrap();
            assert!(changed);
            assert_eq!(steps.len(), 3);
            assert_eq!(steps.get(0), Some((0, 1)));
            assert_eq!(steps.get(1), Some((1, 2)));
            assert_eq!(steps.get(2), Some((2, 3)));
            assert_eq!(read_version(&env, &key), 3);
            assert!(!migrate::<MigrationError, _>(&env, &key, 0, 3, 3, |_, _| {
                panic!("already current")
            })
            .unwrap());
        });
    }

    #[test]
    fn wrong_source_and_future_target_do_not_run_steps() {
        let env = Env::default();
        let contract = env.register_contract(None, TestContract);
        env.as_contract(&contract, || {
            let key: Val = symbol_short!("version").into_val(&env);
            assert_eq!(
                migrate::<MigrationError, _>(&env, &key, 1, 2, 3, |_, _| {
                    panic!("wrong source")
                }),
                Err(MigrationError::VersionMismatch)
            );
            assert_eq!(
                migrate::<MigrationError, _>(&env, &key, 0, 4, 3, |_, _| {
                    panic!("future target")
                }),
                Err(MigrationError::InvalidTarget)
            );
            assert_eq!(read_version(&env, &key), 0);
        });
    }

    #[test]
    fn checked_reads_reject_old_codec_and_accept_current() {
        let env = Env::default();
        let contract = env.register_contract(None, TestContract);
        env.as_contract(&contract, || {
            let key: Val = symbol_short!("version").into_val(&env);
            let value: Val = symbol_short!("value").into_val(&env);
            env.storage().instance().set(&value, &17u32);
            assert_eq!(
                read_current::<u32>(&env, &key, &value, 1),
                Err(MigrationError::VersionMismatch)
            );
            migrate::<MigrationError, _>(&env, &key, 0, 1, 1, |_, _| Ok(())).unwrap();
            assert_eq!(read_current::<u32>(&env, &key, &value, 1), Ok(Some(17)));
        });
    }

    #[test]
    fn rejects_backwards_and_preserves_last_completed_step_on_error() {
        let env = Env::default();
        let contract = env.register_contract(None, TestContract);
        env.as_contract(&contract, || {
            let key: Val = symbol_short!("version").into_val(&env);
            assert_eq!(
                migrate::<MigrationError, _>(&env, &key, 0, 0, 3, |_, _| Ok(())),
                Err(MigrationError::InvalidTarget)
            );
            let result = migrate::<MigrationError, _>(&env, &key, 0, 3, 3, |old, _| {
                if old == 1 {
                    return Err(MigrationError::MissingStep);
                }
                Ok(())
            });
            assert_eq!(result, Err(MigrationError::MissingStep));
            assert_eq!(read_version(&env, &key), 1);
            assert_eq!(
                migrate::<MigrationError, _>(&env, &key, 1, 0, 3, |_, _| Ok(())),
                Err(MigrationError::InvalidTarget)
            );
            assert_eq!(
                read_current::<u32>(&env, &key, &key, 2),
                Err(MigrationError::VersionMismatch)
            );
        });
    }

    use soroban_sdk::contract;
    #[contract]
    struct TestContract;
}
