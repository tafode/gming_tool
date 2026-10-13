//! Finding, installing and driving the [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
//! downloader.
//!
//! The app never bundles `yt-dlp`. On first use it looks for a system install on
//! `PATH`, then for a copy it downloaded earlier, and only then downloads the
//! official standalone build into the app's tools directory. Nothing here runs
//! at startup: the download only happens when a track is added or played.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::resolver::{ResolveError, TrackMetadata};

/// Where releases are published.
const RELEASE_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/// The standalone release asset for the platform we were built for.
///
/// `None` on platforms yt-dlp does not publish a standalone binary for.
pub fn platform_asset() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        Some("yt-dlp.exe")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("yt-dlp_linux")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("yt-dlp_linux_aarch64")
    } else if cfg!(target_os = "macos") {
        Some("yt-dlp_macos")
    } else {
        None
    }
}

/// The file name the tool is stored under (and looked up as on `PATH`).
pub fn program_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// The download URL for a release asset.
pub fn download_url(asset: &str) -> String {
    format!("{RELEASE_BASE}/{asset}")
}

/// A usable `yt-dlp` binary.
#[derive(Debug, Clone)]
pub struct YtDlp {
    program: PathBuf,
}

impl YtDlp {
    /// Find a usable `yt-dlp`, downloading it into `tools_dir` if necessary.
    pub fn discover(tools_dir: &Path) -> Result<Self, ResolveError> {
        // 1. A system-wide install, if the user has one.
        let system = PathBuf::from(program_file_name());
        if runs(&system) {
            return Ok(Self { program: system });
        }

        // 2. A copy we downloaded on an earlier run.
        let local = tools_dir.join(program_file_name());
        if runs(&local) {
            return Ok(Self { program: local });
        }

        // 3. The official standalone build.
        let installed = install(tools_dir)?;
        if runs(&installed) {
            return Ok(Self { program: installed });
        }
        Err(ResolveError::Tool(
            "the downloaded yt-dlp could not be run".to_owned(),
        ))
    }

    /// Look up a video's id and title, without downloading anything.
    pub fn metadata(&self, url: &str) -> Result<TrackMetadata, ResolveError> {
        let stdout = self.run(&[
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            "--print",
            "%(id)s",
            "--print",
            "%(title)s",
            url,
        ])?;
        parse_metadata_output(&stdout)
    }

    /// Download the best audio-only stream for `video_id` into `cache_dir`.
    ///
    /// Returns the file that was produced. `m4a` is preferred because that is
    /// what the bundled decoder is guaranteed to handle; no post-processing is
    /// requested, so `ffmpeg` is not required.
    pub fn download_audio(
        &self,
        url: &str,
        video_id: &str,
        cache_dir: &Path,
    ) -> Result<PathBuf, ResolveError> {
        create_dir(cache_dir)?;

        let template = cache_dir.join(format!("{video_id}.%(ext)s"));
        let template = template.to_str().ok_or_else(|| {
            ResolveError::Tool("the audio cache path is not valid UTF-8".to_owned())
        })?;

        self.run(&[
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            "-f",
            "bestaudio[ext=m4a]/bestaudio/best",
            "-o",
            template,
            url,
        ])?;

        find_audio(cache_dir, video_id).ok_or(ResolveError::NoAudio)
    }

    /// Run `yt-dlp` with `args`, returning its standard output on success.
    fn run(&self, args: &[&str]) -> Result<String, ResolveError> {
        let output = command(&self.program)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .map_err(|err| {
                ResolveError::Tool(format!("could not run {}: {err}", self.program.display()))
            })?;

        if !output.status.success() {
            return Err(ResolveError::Download(last_stderr_line(&output.stderr)));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

/// Parse the two lines produced by the `--print "%(id)s" --print "%(title)s"` run.
fn parse_metadata_output(stdout: &str) -> Result<TrackMetadata, ResolveError> {
    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());

    let video_id = lines
        .next()
        .ok_or_else(|| ResolveError::Download("yt-dlp did not report a video id".to_owned()))?;
    let title = lines.next().unwrap_or(video_id);

    Ok(TrackMetadata {
        video_id: video_id.to_owned(),
        title: title.to_owned(),
    })
}

/// The last non-empty line of `yt-dlp`'s diagnostics, which is where it puts the
/// actual `ERROR:` message.
fn last_stderr_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("yt-dlp failed")
        .to_owned()
}

/// Find the audio file previously downloaded for `video_id`.
///
/// Partially downloaded `.part` files are ignored, as are other videos' files
/// and empty files. `m4a` is preferred over other containers.
pub fn find_audio(cache_dir: &Path, video_id: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(cache_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.file_stem().and_then(|stem| stem.to_str()) == Some(video_id))
        .filter(|path| path.is_file())
        .filter(|path| path.metadata().map(|meta| meta.len() > 0).unwrap_or(false))
        .collect();

    // Stable, so files with the same rank keep directory order.
    candidates.sort_by_key(|path| extension_rank(path));
    candidates.into_iter().next()
}

/// Lower is better: prefer containers the bundled decoder definitely handles.
fn extension_rank(path: &Path) -> u8 {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("m4a") => 0,
        Some("mp3") => 1,
        _ => 2,
    }
}

/// Download and install the standalone `yt-dlp` into `tools_dir`.
///
/// Downloads to a temporary sibling file first, so an interrupted download can
/// never leave a half-written binary that looks runnable.
fn install(tools_dir: &Path) -> Result<PathBuf, ResolveError> {
    let asset = platform_asset().ok_or_else(|| {
        ResolveError::Tool(format!(
            "no prebuilt yt-dlp is published for {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
    })?;

    create_dir(tools_dir)?;

    let target = tools_dir.join(program_file_name());
    let partial = tools_dir.join(format!("{}.partial", program_file_name()));
    let url = download_url(asset);

    let mut response = ureq::get(&url).call().map_err(|err| {
        ResolveError::Network(format!("could not download yt-dlp from {url}: {err}"))
    })?;

    {
        let mut file = std::fs::File::create(&partial).map_err(|err| {
            ResolveError::Tool(format!("could not write {}: {err}", partial.display()))
        })?;
        let mut reader = response.body_mut().as_reader();
        std::io::copy(&mut reader, &mut file)
            .map_err(|err| ResolveError::Network(format!("the download failed: {err}")))?;
        file.flush().map_err(|err| {
            ResolveError::Tool(format!("could not write {}: {err}", partial.display()))
        })?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755)).map_err(
            |err| {
                ResolveError::Tool(format!(
                    "could not mark {} as executable: {err}",
                    partial.display()
                ))
            },
        )?;
    }

    std::fs::rename(&partial, &target)
        .map_err(|err| ResolveError::Tool(format!("could not move yt-dlp into place: {err}")))?;

    Ok(target)
}

fn create_dir(dir: &Path) -> Result<(), ResolveError> {
    std::fs::create_dir_all(dir)
        .map_err(|err| ResolveError::Tool(format!("could not create {}: {err}", dir.display())))
}

/// Whether `program` exists and can be executed.
fn runs(program: &Path) -> bool {
    command(program)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn command(program: &Path) -> Command {
    let command = Command::new(program);

    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt as _;
        // Never flash a console window while running the tool.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };

    command
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("gming_tool_ytdlp_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn publishes_an_asset_for_the_build_platform() {
        // We only build for Linux and Windows, both of which have an asset.
        let asset = platform_asset().expect("an asset for this platform");
        assert_eq!(download_url(asset), format!("{RELEASE_BASE}/{asset}"));

        if cfg!(target_os = "windows") {
            assert_eq!(asset, "yt-dlp.exe");
            assert_eq!(program_file_name(), "yt-dlp.exe");
        } else {
            assert_ne!(asset, "yt-dlp.exe");
            assert_eq!(program_file_name(), "yt-dlp");
        }
    }

    #[test]
    fn parses_id_and_title() {
        let meta = parse_metadata_output("dQw4w9WgXcQ\nNever Gonna Give You Up\n").unwrap();
        assert_eq!(meta.video_id, "dQw4w9WgXcQ");
        assert_eq!(meta.title, "Never Gonna Give You Up");
    }

    #[test]
    fn falls_back_to_the_id_when_there_is_no_title() {
        let meta = parse_metadata_output("abc123\n").unwrap();
        assert_eq!(meta.video_id, "abc123");
        assert_eq!(meta.title, "abc123");
    }

    #[test]
    fn reports_empty_output_as_a_download_error() {
        assert!(matches!(
            parse_metadata_output("   \n\n"),
            Err(ResolveError::Download(_))
        ));
    }

    #[test]
    fn surfaces_the_last_stderr_line() {
        let stderr = b"WARNING: something\nERROR: [youtube] bad: Video unavailable\n";
        assert_eq!(
            last_stderr_line(stderr),
            "ERROR: [youtube] bad: Video unavailable"
        );
        assert_eq!(last_stderr_line(b""), "yt-dlp failed");
    }

    #[test]
    fn finds_the_m4a_in_preference_to_other_containers() {
        let dir = temp_dir("find_m4a");
        std::fs::write(dir.join("abc.webm"), b"x").unwrap();
        std::fs::write(dir.join("abc.m4a"), b"x").unwrap();
        std::fs::write(dir.join("other.m4a"), b"x").unwrap();

        assert_eq!(find_audio(&dir, "abc"), Some(dir.join("abc.m4a")));
        assert_eq!(find_audio(&dir, "missing"), None);
    }

    #[test]
    fn ignores_partial_and_empty_downloads() {
        let dir = temp_dir("find_partial");
        std::fs::write(dir.join("abc.m4a.part"), b"half").unwrap();
        std::fs::write(dir.join("def.m4a"), b"").unwrap();

        assert_eq!(find_audio(&dir, "abc"), None, ".part files are not usable");
        assert_eq!(find_audio(&dir, "def"), None, "empty files are not usable");
    }

    #[test]
    fn does_not_find_audio_in_a_missing_directory() {
        assert_eq!(find_audio(Path::new("/definitely/not/here"), "abc"), None);
    }

    /// End-to-end check against the real yt-dlp and YouTube: installs the
    /// binary, looks up metadata, downloads the audio, and confirms the result
    /// is cached.
    ///
    /// Ignored by default because it needs network access and downloads the
    /// ~30 MB yt-dlp binary. Run it explicitly with:
    ///
    /// ```text
    /// cargo test -- --ignored real_yt_dlp
    /// ```
    #[test]
    #[ignore = "needs network access; downloads yt-dlp and one video"]
    fn real_yt_dlp_resolves_and_downloads() {
        const URL: &str = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

        let dir = temp_dir("real_round_trip");
        let cache = dir.join("audio");

        let tool = YtDlp::discover(&dir.join("bin")).expect("install yt-dlp");

        let meta = tool.metadata(URL).expect("fetch metadata");
        assert_eq!(meta.video_id, "dQw4w9WgXcQ");
        assert!(!meta.title.trim().is_empty());

        let path = tool
            .download_audio(URL, &meta.video_id, &cache)
            .expect("download audio");
        assert!(path.is_file(), "{} should exist", path.display());
        assert!(path.metadata().expect("metadata").len() > 0);

        // The cached file is what a later call would serve.
        assert_eq!(find_audio(&cache, &meta.video_id), Some(path.clone()));

        // ...and it must actually be decodable by the playback stack. This
        // needs no audio device, so it also runs on headless machines.
        let file = std::fs::File::open(&path).expect("open downloaded audio");
        let decoder = rodio::Decoder::try_from(file).expect("decode downloaded audio");
        assert!(
            decoder.take(4096).count() == 4096,
            "decoder produced too few samples"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
