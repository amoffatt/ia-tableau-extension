
function showConsoleIn(parent) {
    $(parent)
        .append($("#console-out"));
}

function appendConsoleMessage(m) {
    $('#console-out')
        .append(
            "<p>" + m + "</p>");
}

function copyConsoleToClipboard() {
    var range = document.createRange();
    range.selectNode(document.getElementById("console-out"));
    window.getSelection().removeAllRanges(); // clear current selection
    window.getSelection().addRange(range); // to select text
    document.execCommand("copy");
    window.getSelection().removeAllRanges();// to deselect
}

function setupConsoleDisplays() {
    console.log("Initializing console output display");

    ['log', 'info', 'debug', 'error'].forEach(method => {

        let fn = console[method];
        if (!fn)
            return;

        // console[method] = function() {
        //     appendConsoleMessage(arguments[0]);
        //     fn.apply(console, arguments);
        // }
    });

    window.onerror = (message) => appendConsoleMessage(message);


    $("#console-out-modal").on('show.bs.modal', e => showConsoleIn("#main-console-display"));
    $("#loading-console-display").on('show.bs.collapse', e => showConsoleIn("#loading-console-display"));

    $("#console-out .ia-copy-content").click(copyConsoleToClipboard);
}

setupConsoleDisplays();

