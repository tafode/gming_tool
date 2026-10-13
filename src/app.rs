use eframe::egui;

/// Root application state.
///
/// Intentionally empty for now. As features land, this grows into a thin
/// shell that delegates to `ui/`, `model/`, and `persistence/` modules.
#[derive(Default)]
pub struct GmingToolApp;

impl eframe::App for GmingToolApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ui, |_ui| {
            // Empty window for now.
        });
    }
}
