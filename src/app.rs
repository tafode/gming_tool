use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use eframe::egui;

use crate::model::store::{self, CURRENT_SCHEMA_VERSION, SaveData};
use crate::model::{ChapterId, MusicLibrary, Story, TrackId};
use crate::music::output::AudioOutput;
use crate::music::resolver::{ResolveError, Resolver, TrackMetadata};
use crate::music::{placeholder_title, video_id_from_url};

/// How long the app waits after a change before writing the save file.
const AUTOSAVE_DELAY: Duration = Duration::from_secs(1);

/// What the status bar is currently saying.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Status {
    #[default]
    Idle,
    Info(String),
    Error(String),
}

impl Status {
    fn text(&self) -> &str {
        match self {
            Self::Idle => "",
            Self::Info(message) | Self::Error(message) => message,
        }
    }

    fn is_error(&self) -> bool {
        matches!(self, Self::Error(_))
    }
}

/// A finished background job.
enum FetchResult {
    Metadata {
        track_id: TrackId,
        metadata: TrackMetadata,
    },
    MetadataFailed {
        track_id: TrackId,
        message: String,
    },
    AudioReady {
        track_id: TrackId,
        path: PathBuf,
    },
    AudioFailed {
        track_id: TrackId,
        message: String,
    },
}

/// Something the user did, applied once the panels have been drawn.
#[derive(Debug)]
enum Action {
    AddTrack(String),
    PlayTrack(TrackId),
    DeleteTrack(TrackId),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
}

/// Root application state.
pub struct GmingToolApp {
    // The persisted document.
    story: Story,
    selected: ChapterId,
    music: MusicLibrary,

    // Persistence bookkeeping.
    save_path: PathBuf,
    dirty: bool,
    last_save: Instant,
    status: Status,

    // Backends.
    resolver: Arc<dyn Resolver>,
    audio: Box<dyn AudioOutput>,

    // Background jobs.
    fetch_tx: Sender<FetchResult>,
    fetch_rx: Receiver<FetchResult>,
    resolving: HashSet<TrackId>,
    loading: Option<TrackId>,

    // Runtime music state. Never persisted: local paths are machine-specific.
    audio_paths: HashMap<TrackId, PathBuf>,
    video_ids: HashMap<TrackId, String>,
    playing: Option<TrackId>,

    // UI state.
    volume: f32,
    url_input: String,
}

impl GmingToolApp {
    /// Build the app, loading any existing save file at `save_path`.
    pub fn new(
        save_path: PathBuf,
        resolver: Arc<dyn Resolver>,
        audio: Box<dyn AudioOutput>,
    ) -> Self {
        let mut status = Status::Idle;
        let data = match store::load(&save_path) {
            Ok(Some(data)) => data,
            Ok(None) => SaveData::new(),
            Err(err) => {
                // Don't silently destroy whatever the user had.
                status = match store::backup(&save_path) {
                    Ok(Some(backup)) => Status::Error(format!(
                        "could not read the save file ({err}); it was moved to {}",
                        backup.display()
                    )),
                    Ok(None) => Status::Error(format!("could not read the save file: {err}")),
                    Err(backup_err) => Status::Error(format!(
                        "could not read the save file ({err}) and could not back it up ({backup_err})"
                    )),
                };
                SaveData::new()
            }
        };
        Self::from_data(save_path, data, resolver, audio, status)
    }

    fn from_data(
        save_path: PathBuf,
        data: SaveData,
        resolver: Arc<dyn Resolver>,
        audio: Box<dyn AudioOutput>,
        status: Status,
    ) -> Self {
        let SaveData {
            mut story, music, ..
        } = data;
        let selected = match story.chapters().first() {
            Some(chapter) => chapter.id,
            None => story.add_chapter(),
        };
        let volume = audio.volume();
        let (fetch_tx, fetch_rx) = mpsc::channel();

        let mut app = Self {
            story,
            selected,
            music,
            save_path,
            dirty: false,
            last_save: Instant::now(),
            status,
            resolver,
            audio,
            fetch_tx,
            fetch_rx,
            resolving: HashSet::new(),
            loading: None,
            audio_paths: HashMap::new(),
            video_ids: HashMap::new(),
            playing: None,
            volume,
            url_input: String::new(),
        };
        app.audio.set_volume(app.volume);
        app
    }

    /// Draw the whole UI into `ui`.
    ///
    /// Split out from [`eframe::App::ui`] so it can also be driven headlessly in
    /// tests. Background work is polled here rather than in
    /// [`eframe::App::logic`] because the test harness only runs this method.
    pub fn draw(&mut self, ui: &mut egui::Ui) {
        self.poll_background();
        self.autosave();

        let ctx = ui.ctx().clone();
        let mut actions: Vec<Action> = Vec::new();

        self.draw_chapters(ui);
        self.draw_music(ui, &mut actions);
        self.draw_status_bar(ui);
        self.draw_editor(ui);

        for action in actions {
            self.apply(action, &ctx);
        }
    }

    fn draw_chapters(&mut self, ui: &mut egui::Ui) {
        egui::Panel::left("chapter_list")
            .default_size(220.0)
            .resizable(true)
            .show(ui, |ui| {
                ui.heading("Chapters");
                ui.add_space(4.0);

                if ui.button("➕ New chapter").clicked() {
                    self.selected = self.story.add_chapter();
                    self.dirty = true;
                }

                ui.separator();

                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        let Self {
                            story, selected, ..
                        } = self;
                        for chapter in story.chapters() {
                            let is_selected = *selected == chapter.id;
                            if ui.selectable_label(is_selected, &chapter.title).clicked() {
                                *selected = chapter.id;
                            }
                        }
                    });
            });
    }

    fn draw_music(&mut self, ui: &mut egui::Ui, actions: &mut Vec<Action>) {
        egui::Panel::right("music_panel")
            .default_size(280.0)
            .resizable(true)
            .show(ui, |ui| {
                let Self {
                    music,
                    url_input,
                    playing,
                    loading,
                    resolving,
                    volume,
                    audio,
                    ..
                } = self;

                // Pinned header, so it stays visible while the list scrolls.
                egui::Panel::top("music_header").show(ui, |ui| {
                    ui.heading("Music");
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        let field = ui.add(
                            egui::TextEdit::singleline(url_input)
                                .hint_text("YouTube URL…")
                                .desired_width((ui.available_width() - 52.0).max(80.0)),
                        );
                        let submitted = field.lost_focus()
                            && ui.input(|input| input.key_pressed(egui::Key::Enter));
                        if ui.button("Add").clicked() || submitted {
                            actions.push(Action::AddTrack(url_input.clone()));
                        }
                    });
                });

                // Pinned transport, so a long track list can never push the
                // playback controls out of the panel.
                egui::Panel::bottom("music_transport").show(ui, |ui| {
                    ui.add_space(4.0);
                    let audio_playing = audio.is_playing();
                    ui.horizontal(|ui| {
                        let has_track = playing.is_some();
                        if ui
                            .add_enabled(has_track && !audio_playing, egui::Button::new("▶"))
                            .on_hover_text("Resume")
                            .clicked()
                        {
                            actions.push(Action::Resume);
                        }
                        if ui
                            .add_enabled(audio_playing, egui::Button::new("⏸"))
                            .on_hover_text("Pause")
                            .clicked()
                        {
                            actions.push(Action::Pause);
                        }
                        if ui
                            .add_enabled(has_track, egui::Button::new("⏹"))
                            .on_hover_text("Stop")
                            .clicked()
                        {
                            actions.push(Action::Stop);
                        }
                        ui.separator();
                        if ui
                            .add(egui::Slider::new(volume, 0.0..=1.0).show_value(false))
                            .changed()
                        {
                            actions.push(Action::SetVolume(*volume));
                        }
                    });
                });

                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        if music.tracks().is_empty() {
                            ui.weak("No tracks yet. Paste a YouTube link above.");
                        }
                        for track in music.tracks() {
                            ui.horizontal(|ui| {
                                let is_playing = *playing == Some(track.id);
                                let busy =
                                    resolving.contains(&track.id) || *loading == Some(track.id);
                                let label = if busy {
                                    format!("⏳ {}", track.title)
                                } else if is_playing {
                                    format!("▶ {}", track.title)
                                } else {
                                    track.title.clone()
                                };
                                if ui.selectable_label(is_playing, label).clicked() {
                                    actions.push(Action::PlayTrack(track.id));
                                }
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        if ui.button("✕").clicked() {
                                            actions.push(Action::DeleteTrack(track.id));
                                        }
                                    },
                                );
                            });
                        }
                    });
            });
    }

    fn draw_status_bar(&mut self, ui: &mut egui::Ui) {
        egui::Panel::bottom("status_bar").show(ui, |ui| {
            let text = if self.status.text().is_empty() {
                if self.dirty {
                    "Unsaved changes"
                } else {
                    "Ready"
                }
            } else {
                self.status.text()
            };
            if self.status.is_error() {
                ui.label(egui::RichText::new(text).color(ui.visuals().error_fg_color));
            } else {
                ui.label(egui::RichText::new(text).weak());
            }
        });
    }

    fn draw_editor(&mut self, ui: &mut egui::Ui) {
        egui::CentralPanel::default().show(ui, |ui| {
            let Self {
                story,
                selected,
                dirty,
                ..
            } = self;
            let Some(chapter) = story.chapter_mut(*selected) else {
                return;
            };
            let id = chapter.id;
            let title = chapter.title.clone();

            ui.heading(&title);
            ui.separator();

            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    let response = ui.add(
                        egui::TextEdit::multiline(&mut chapter.text)
                            // Per-chapter editor state: cursor and scroll
                            // position are remembered separately.
                            .id_salt(id)
                            .desired_width(f32::INFINITY)
                            .desired_rows(30)
                            .hint_text("Write the story for this chapter…"),
                    );
                    if response.changed() {
                        *dirty = true;
                    }
                });
        });
    }

    // -- background work ---------------------------------------------------

    /// Drain finished background jobs and react to the audio state.
    fn poll_background(&mut self) {
        while let Ok(result) = self.fetch_rx.try_recv() {
            self.handle_fetch_result(result);
        }

        if let Some(_track) = self.playing {
            if self.audio.is_finished() {
                self.playing = None;
                self.status = Status::Idle;
            }
        }
    }

    fn handle_fetch_result(&mut self, result: FetchResult) {
        match result {
            FetchResult::Metadata { track_id, metadata } => {
                self.resolving.remove(&track_id);
                self.video_ids.insert(track_id, metadata.video_id);
                if self.music.set_title(track_id, metadata.title) {
                    self.dirty = true;
                }
            }
            FetchResult::MetadataFailed { track_id, message } => {
                self.resolving.remove(&track_id);
                self.status = Status::Error(message);
            }
            FetchResult::AudioReady { track_id, path } => {
                self.audio_paths.insert(track_id, path.clone());
                if self.loading == Some(track_id) {
                    self.loading = None;
                    self.start_playback(track_id, &path);
                }
            }
            FetchResult::AudioFailed { track_id, message } => {
                if self.loading == Some(track_id) {
                    self.loading = None;
                }
                self.status = Status::Error(message);
            }
        }
    }

    fn apply(&mut self, action: Action, ctx: &egui::Context) {
        match action {
            Action::AddTrack(raw) => {
                let url = raw.trim().to_owned();
                if url.is_empty() {
                    return;
                }
                let track_id = self.music.add_track(url.clone(), placeholder_title(&url));
                self.url_input.clear();
                self.dirty = true;
                self.status = Status::Info("Looking up title…".to_owned());
                self.spawn_metadata(track_id, url, ctx);
            }
            Action::PlayTrack(track_id) => {
                if let Some(path) = self.audio_paths.get(&track_id).cloned() {
                    self.start_playback(track_id, &path);
                    return;
                }
                // Already being downloaded and prepared; a second click must not
                // start a competing download of the same file.
                if self.loading == Some(track_id) {
                    return;
                }
                let Some(url) = self.music.url_of(track_id).map(str::to_owned) else {
                    return;
                };
                // Without a video id we have no sane name for the cached file,
                // so refuse rather than downloading to a nonsense path.
                let Some(video_id) = self
                    .video_ids
                    .get(&track_id)
                    .cloned()
                    .or_else(|| video_id_from_url(&url))
                else {
                    self.status = Status::Error(ResolveError::NotYouTube.to_string());
                    return;
                };
                self.loading = Some(track_id);
                self.status = Status::Info("Preparing audio…".to_owned());
                self.spawn_audio(track_id, url, video_id, ctx);
            }
            Action::DeleteTrack(track_id) => {
                if self.playing == Some(track_id) {
                    self.audio.stop();
                    self.playing = None;
                }
                if self.loading == Some(track_id) {
                    self.loading = None;
                }
                self.audio_paths.remove(&track_id);
                self.video_ids.remove(&track_id);
                self.resolving.remove(&track_id);
                if self.music.remove_track(track_id).is_some() {
                    self.dirty = true;
                }
            }
            Action::Pause => self.audio.pause(),
            Action::Resume => self.audio.resume(),
            Action::Stop => {
                self.audio.stop();
                self.playing = None;
                self.status = Status::Idle;
            }
            Action::SetVolume(volume) => self.set_volume(volume),
        }
    }

    fn start_playback(&mut self, track_id: TrackId, path: &Path) {
        match self.audio.play_file(path) {
            Ok(()) => {
                self.playing = Some(track_id);
                let title = self
                    .music
                    .tracks()
                    .iter()
                    .find(|t| t.id == track_id)
                    .map(|t| t.title.clone())
                    .unwrap_or_default();
                self.status = Status::Info(format!("Playing {title}"));
            }
            Err(err) => {
                self.playing = None;
                self.status = Status::Error(err.to_string());
            }
        }
    }

    fn spawn_metadata(&mut self, track_id: TrackId, url: String, ctx: &egui::Context) {
        let resolver = Arc::clone(&self.resolver);
        let tx = self.fetch_tx.clone();
        let ctx = ctx.clone();
        self.resolving.insert(track_id);
        std::thread::spawn(move || {
            let result = match resolver.metadata(&url) {
                Ok(metadata) => FetchResult::Metadata { track_id, metadata },
                Err(err) => FetchResult::MetadataFailed {
                    track_id,
                    message: err.to_string(),
                },
            };
            let _ = tx.send(result);
            ctx.request_repaint();
        });
    }

    fn spawn_audio(
        &mut self,
        track_id: TrackId,
        url: String,
        video_id: String,
        ctx: &egui::Context,
    ) {
        let resolver = Arc::clone(&self.resolver);
        let tx = self.fetch_tx.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let result = match resolver.audio_file(&url, &video_id) {
                Ok(path) => FetchResult::AudioReady { track_id, path },
                Err(err) => FetchResult::AudioFailed {
                    track_id,
                    message: err.to_string(),
                },
            };
            let _ = tx.send(result);
            ctx.request_repaint();
        });
    }

    /// Change the output volume.
    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        self.audio.set_volume(self.volume);
    }

    // -- persistence -------------------------------------------------------

    fn autosave(&mut self) {
        if self.dirty && self.last_save.elapsed() >= AUTOSAVE_DELAY {
            self.save_now();
        }
    }

    /// Write the save file immediately.
    pub fn save_now(&mut self) {
        let data = SaveData {
            schema_version: CURRENT_SCHEMA_VERSION,
            story: self.story.clone(),
            music: self.music.clone(),
        };
        self.last_save = Instant::now();
        match store::save(&self.save_path, &data) {
            Ok(()) => self.dirty = false,
            Err(err) => self.status = Status::Error(format!("could not save: {err}")),
        }
    }
}

impl eframe::App for GmingToolApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.draw(ui);
    }

    fn on_exit(&mut self) {
        if self.dirty {
            self.save_now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::output::SilentAudioOutput;
    use crate::music::resolver::ResolveError;
    use egui::accesskit::Role;
    use egui_kittest::{Harness, kittest::Queryable};

    /// A resolver that needs no network: the title is the video id and the
    /// "downloaded" audio lives under a temporary cache directory.
    struct TestResolver {
        cache_dir: PathBuf,
    }

    impl TestResolver {
        fn new(cache_dir: impl Into<PathBuf>) -> Self {
            Self {
                cache_dir: cache_dir.into(),
            }
        }
    }

    impl Resolver for TestResolver {
        fn metadata(&self, url: &str) -> Result<TrackMetadata, ResolveError> {
            let video_id = crate::music::video_id_from_url(url).ok_or(ResolveError::NotYouTube)?;
            Ok(TrackMetadata {
                title: video_id.clone(),
                video_id,
            })
        }

        fn audio_file(&self, _url: &str, video_id: &str) -> Result<PathBuf, ResolveError> {
            Ok(self.cache_dir.join(format!("{video_id}.m4a")))
        }
    }

    impl GmingToolApp {
        fn chapter_count(&self) -> usize {
            self.story.chapters().len()
        }

        fn selected_title(&self) -> &str {
            self.story
                .chapters()
                .iter()
                .find(|c| c.id == self.selected)
                .expect("a chapter is always selected")
                .title
                .as_str()
        }

        fn track_count(&self) -> usize {
            self.music.tracks().len()
        }

        fn track_title(&self, index: usize) -> &str {
            self.music.tracks()[index].title.as_str()
        }

        fn playing_track(&self) -> Option<TrackId> {
            self.playing
        }

        fn has_pending_tasks(&self) -> bool {
            !self.resolving.is_empty() || self.loading.is_some()
        }
    }

    fn chapter_text(harness: &Harness<'_, GmingToolApp>) -> String {
        harness
            .get_by_role(Role::MultilineTextInput)
            .value()
            .unwrap_or_default()
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("gming_tool_app_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    /// Build an app backed by a fake resolver and silent audio, using a fresh
    /// temporary directory so tests never touch real user data.
    fn build_app(tag: &str) -> (GmingToolApp, SilentAudioOutput, PathBuf) {
        let dir = temp_dir(tag);
        let audio = SilentAudioOutput::default();
        let resolver = Arc::new(TestResolver::new(dir.join("audio")));
        let app = GmingToolApp::new(dir.join("save.json"), resolver, Box::new(audio.clone()));
        (app, audio, dir)
    }

    fn harness(app: GmingToolApp) -> Harness<'static, GmingToolApp> {
        Harness::new_ui_state(|ui, app: &mut GmingToolApp| app.draw(ui), app)
    }

    /// Run frames until every background job has been reported back.
    fn settle(harness: &mut Harness<'static, GmingToolApp>) {
        for _ in 0..400 {
            harness.run();
            if !harness.state().has_pending_tasks() {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("background jobs never settled");
    }

    fn add_track_through_ui(harness: &mut Harness<'static, GmingToolApp>, url: &str) {
        harness.get_by_role(Role::TextInput).focus();
        harness.get_by_role(Role::TextInput).type_text(url);
        harness.get_by_label("Add").click();
        harness.run();
        settle(harness);
    }

    // -- chapters ----------------------------------------------------------

    #[test]
    fn starts_with_a_single_selected_chapter() {
        let (app, _audio, _dir) = build_app("single_chapter");
        let harness = harness(app);
        assert_eq!(harness.state().chapter_count(), 1);
        assert_eq!(harness.state().selected_title(), "Chapter 1");
    }

    #[test]
    fn new_chapter_button_appends_and_selects_it() {
        let (app, _audio, _dir) = build_app("new_chapter");
        let mut harness = harness(app);

        harness.get_by_label("➕ New chapter").click();
        harness.run();

        assert_eq!(harness.state().chapter_count(), 2);
        assert_eq!(harness.state().selected_title(), "Chapter 2");
    }

    #[test]
    fn switching_chapters_shows_that_chapters_own_text() {
        let (app, _audio, _dir) = build_app("switch_chapters");
        let mut harness = harness(app);

        harness.get_by_role(Role::MultilineTextInput).focus();
        harness
            .get_by_role(Role::MultilineTextInput)
            .type_text("alpha");
        harness.run();
        assert_eq!(chapter_text(&harness), "alpha");

        harness.get_by_label("➕ New chapter").click();
        harness.run();
        assert_eq!(chapter_text(&harness), "");

        harness.get_by_role(Role::MultilineTextInput).focus();
        harness
            .get_by_role(Role::MultilineTextInput)
            .type_text("beta");
        harness.run();
        assert_eq!(chapter_text(&harness), "beta");

        harness
            .get_by_role_and_label(Role::Button, "Chapter 1")
            .click();
        harness.run();
        assert_eq!(harness.state().selected_title(), "Chapter 1");
        assert_eq!(chapter_text(&harness), "alpha");
    }

    // -- music -------------------------------------------------------------

    #[test]
    fn adding_a_url_creates_a_track_with_a_resolved_title() {
        let (app, _audio, _dir) = build_app("add_track");
        let mut harness = harness(app);

        add_track_through_ui(&mut harness, "https://youtu.be/dQw4w9WgXcQ");

        assert_eq!(harness.state().track_count(), 1);
        assert_eq!(harness.state().track_title(0), "dQw4w9WgXcQ");
    }

    #[test]
    fn clicking_a_track_plays_its_audio() {
        let (app, audio, dir) = build_app("play_track");
        let mut harness = harness(app);
        add_track_through_ui(&mut harness, "https://youtu.be/dQw4w9WgXcQ");

        harness
            .get_by_role_and_label(Role::Button, "dQw4w9WgXcQ")
            .click();
        harness.run();
        settle(&mut harness);

        assert_eq!(
            audio.played_files(),
            vec![dir.join("audio").join("dQw4w9WgXcQ.m4a")]
        );
        assert!(harness.state().playing_track().is_some());
    }

    #[test]
    fn deleting_a_track_removes_it_from_the_list() {
        let (app, _audio, _dir) = build_app("delete_track");
        let mut harness = harness(app);
        add_track_through_ui(&mut harness, "https://youtu.be/dQw4w9WgXcQ");

        harness.get_by_label("✕").click();
        harness.run();

        assert_eq!(harness.state().track_count(), 0);
    }

    #[test]
    fn stopping_clears_the_playing_track() {
        let (app, audio, _dir) = build_app("stop_track");
        let mut harness = harness(app);
        add_track_through_ui(&mut harness, "https://youtu.be/dQw4w9WgXcQ");

        harness
            .get_by_role_and_label(Role::Button, "dQw4w9WgXcQ")
            .click();
        harness.run();
        settle(&mut harness);
        assert!(harness.state().playing_track().is_some());

        harness.get_by_label("⏹").click();
        harness.run();

        assert!(harness.state().playing_track().is_none());
        assert!(audio.was_stopped());
    }

    #[test]
    fn volume_changes_reach_the_audio_backend() {
        let (mut app, audio, _dir) = build_app("volume");
        app.set_volume(0.25);
        assert_eq!(audio.volume(), 0.25);
        assert_eq!(app.volume, 0.25);

        // Out-of-range values are clamped rather than passed on.
        app.set_volume(9.0);
        assert_eq!(audio.volume(), 1.0);
    }

    #[test]
    fn an_invalid_url_reports_an_error_and_adds_no_playable_track() {
        let (app, _audio, _dir) = build_app("bad_url");
        let mut harness = harness(app);

        add_track_through_ui(&mut harness, "definitely not a link");

        // The row is added optimistically, but the resolver rejects it.
        assert!(harness.state().status.is_error());
        assert_eq!(harness.state().track_count(), 1);
    }

    #[test]
    fn playing_a_track_with_an_unrecognised_url_is_refused() {
        let (app, audio, _dir) = build_app("play_bad_url");
        let mut harness = harness(app);
        add_track_through_ui(&mut harness, "definitely not a link");

        harness
            .get_by_role_and_label(Role::Button, "definitely not a link")
            .click();
        harness.run();
        settle(&mut harness);

        // Without a video id there is no usable name for the cached file, so
        // nothing may be downloaded or played.
        assert_eq!(harness.state().playing_track(), None);
        assert!(audio.played_files().is_empty());
        assert!(harness.state().status.is_error());
    }

    // -- persistence -------------------------------------------------------

    #[test]
    fn changes_are_saved_and_reloaded() {
        let (mut app, _audio, dir) = build_app("persist");
        let save_path = dir.join("save.json");

        let track = app.music.add_track("https://youtu.be/abc", "Pinned");
        app.music.set_title(track, "Tavern Ambience");
        let first = app.story.chapters()[0].id;
        app.story.chapter_mut(first).unwrap().text = "The party arrives".to_owned();
        app.save_now();

        let audio = SilentAudioOutput::default();
        let resolver = Arc::new(TestResolver::new(dir.join("audio")));
        let reloaded = GmingToolApp::new(save_path, resolver, Box::new(audio));

        assert_eq!(reloaded.music.tracks().len(), 1);
        assert_eq!(reloaded.music.tracks()[0].title, "Tavern Ambience");
        assert_eq!(reloaded.story.chapters()[0].text, "The party arrives");
    }

    #[test]
    fn a_corrupt_save_file_is_backed_up_and_reported() {
        let dir = temp_dir("corrupt");
        let save_path = dir.join("save.json");
        std::fs::write(&save_path, "{ not json at all").expect("write");

        let audio = SilentAudioOutput::default();
        let resolver = Arc::new(TestResolver::new(dir.join("audio")));
        let app = GmingToolApp::new(save_path.clone(), resolver, Box::new(audio));

        assert!(app.status.is_error());
        assert!(!save_path.exists());
        assert!(dir.join("save.json.bak").exists());
    }
}
