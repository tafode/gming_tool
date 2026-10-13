mod app;
mod model;
mod music;

use std::sync::Arc;

use app::GmingToolApp;
use eframe::egui;
use model::store::AppDirs;
use music::output::{AudioOutput, RodioOutput, SilentAudioOutput};
use music::resolver::YtDlpResolver;

fn main() -> eframe::Result<()> {
    let dirs = match AppDirs::resolve() {
        Ok(dirs) => dirs,
        Err(err) => {
            eprintln!("gming_tool: {err}");
            std::process::exit(1);
        }
    };

    let resolver = Arc::new(YtDlpResolver::new(dirs.audio_cache_dir(), dirs.tools_dir()));

    // Fall back to a silent device if there is no sound card (or it is busy):
    // the rest of the tool stays usable.
    let audio: Box<dyn AudioOutput> = match RodioOutput::new() {
        Ok(output) => Box::new(output),
        Err(err) => {
            eprintln!("gming_tool: audio disabled ({err})");
            Box::new(SilentAudioOutput::default())
        }
    };

    let app = GmingToolApp::new(dirs.save_file(), resolver, audio);

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("GMing Tool")
            .with_inner_size([1280.0, 800.0])
            .with_min_inner_size([800.0, 500.0]),
        ..Default::default()
    };

    eframe::run_native(
        "GMing Tool",
        native_options,
        Box::new(|_cc| Ok(Box::new(app))),
    )
}
