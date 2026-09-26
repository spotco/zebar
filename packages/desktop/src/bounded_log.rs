use std::{
  fs::{self, File, OpenOptions},
  io::{self, Write},
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use tracing_subscriber::fmt::writer::MakeWriter;

/// Soft cap for each runtime log file. The `.1` file is replaced on
/// rotate.
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct BoundedLogMakeWriter {
  state: Arc<Mutex<BoundedLogState>>,
}

struct BoundedLogState {
  file: File,
  path: PathBuf,
  bytes: u64,
}

/// Create a size-bounded tracing writer backed by `path`.
///
/// Existing files at or above the cap are rotated before the writer is
/// returned. Runtime writes rotate again as needed, keeping one `.1`
/// backup.
pub fn create(
  path: impl Into<PathBuf>,
) -> io::Result<BoundedLogMakeWriter> {
  let path = path.into();
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }

  let bytes = match fs::metadata(&path) {
    Ok(metadata) => metadata.len(),
    Err(err) if err.kind() == io::ErrorKind::NotFound => 0,
    Err(err) => return Err(err),
  };

  if bytes >= MAX_LOG_BYTES {
    rotate_path(&path)?;
  }

  let file = open_append(&path)?;
  let bytes = file.metadata()?.len();

  Ok(BoundedLogMakeWriter {
    state: Arc::new(Mutex::new(BoundedLogState { file, path, bytes })),
  })
}

impl<'a> MakeWriter<'a> for BoundedLogMakeWriter {
  type Writer = BoundedLogWriter;

  fn make_writer(&'a self) -> Self::Writer {
    BoundedLogWriter {
      state: Arc::clone(&self.state),
    }
  }
}

pub struct BoundedLogWriter {
  state: Arc<Mutex<BoundedLogState>>,
}

impl Write for BoundedLogWriter {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    let mut state = self
      .state
      .lock()
      .map_err(|_| io::Error::other("bounded log mutex poisoned"))?;
    let mut written = 0;

    while written < buf.len() {
      if state.bytes >= MAX_LOG_BYTES {
        state.rotate()?;
      }

      let available = (MAX_LOG_BYTES - state.bytes) as usize;
      let chunk_len = available.min(buf.len() - written);
      let chunk = &buf[written..written + chunk_len];
      let count = state.file.write(chunk)?;
      if count == 0 {
        return Err(io::Error::new(
          io::ErrorKind::WriteZero,
          "bounded log writer wrote zero bytes",
        ));
      }
      state.bytes += count as u64;
      written += count;
    }

    Ok(written)
  }

  fn flush(&mut self) -> io::Result<()> {
    let mut state = self
      .state
      .lock()
      .map_err(|_| io::Error::other("bounded log mutex poisoned"))?;
    state.file.flush()
  }
}

impl BoundedLogState {
  fn rotate(&mut self) -> io::Result<()> {
    self.file.flush()?;
    rotate_path(&self.path)?;
    self.file = open_append(&self.path)?;
    self.bytes = 0;
    Ok(())
  }
}

fn open_append(path: &Path) -> io::Result<File> {
  OpenOptions::new().create(true).append(true).open(path)
}

fn rotate_path(path: &Path) -> io::Result<()> {
  let backup = PathBuf::from(format!("{}.1", path.display()));
  match fs::remove_file(&backup) {
    Ok(()) => {}
    Err(err) if err.kind() == io::ErrorKind::NotFound => {}
    Err(err) => return Err(err),
  }

  match fs::rename(path, backup) {
    Ok(()) => Ok(()),
    Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
    Err(err) => Err(err),
  }
}

#[cfg(test)]
mod tests {
  use std::{
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
  };

  use tracing_subscriber::fmt::writer::MakeWriter;

  use super::{create, MAX_LOG_BYTES};

  #[test]
  fn rotates_at_the_size_cap() {
    let suffix = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock")
      .as_nanos();
    let dir = std::env::temp_dir()
      .join(format!("zebar-bounded-log-{}-{suffix}", std::process::id()));
    fs::create_dir_all(&dir).expect("create test directory");
    let path = dir.join("zebar.log");
    let writer = create(&path).expect("create bounded writer");
    let mut sink = writer.make_writer();
    let cap = usize::try_from(MAX_LOG_BYTES).expect("test cap fits usize");
    sink.write_all(&vec![b'a'; cap]).expect("fill log");
    sink.write_all(b"next").expect("rotate log");
    sink.flush().expect("flush log");
    drop(sink);
    drop(writer);

    assert_eq!(fs::read(&path).expect("read active log"), b"next");
    assert_eq!(
      fs::read(dir.join("zebar.log.1")).expect("read rotated log"),
      vec![b'a'; cap]
    );

    fs::remove_dir_all(dir).expect("remove test directory");
  }
}
