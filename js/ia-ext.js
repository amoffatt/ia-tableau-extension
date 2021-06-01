/**
 * ©2021 Virtual Cove, Inc. d/b/a Immersion Analytics. All Rights Reserved. Patented.
 *
 * Immersion Analytics Runtime - Tableau Dashboard Extension
 * Utilizes the Immersion Analytics Runtime javascript API and Tableau Dashboard Extensions API
 * to drive holographic visualizations in AR/VR/XR devices like Hololens2 or Oculus from a Tableau dashboard
 */
class IAExt {
    constructor(integration)
    {
        let $this = this;       // for event callbacks
        this.integration = integration;

        console.log("Initialize IA");

        // Create a new Immersion Analytics (IA) Runtime API client
        this.ia = IA.CreateClient();

        //================================================
        // Initialize IA Runtime event listeners
        //================================================
        this.ia.OnStateChanged(state => this._handleStateChanged(state));
        this.ia.OnRoomPasswordRequired((uri, msg) => this._handleRoomPasswordRequired(uri, msg));

        // Once the IA Scene synchronization between XR device and web browser is initialized this method will be called
        this.ia.OnSyncReady(() => this._handleRoomConnectionReady());

        // Update this Visualization list when Viz's are added or removed
        this.ia.Scene.Visualizations.OnChanged(() => this._handleVizListChanged());
        // Listen for Viz selection changes coming from the headset
        this.ia.Scene.Selection.OnChanged(property => {
            let viz = property.GetIndex(0);
            if (viz)
                this.selectViz(viz.Name);
        })

        //================================================
        // Connection parameters panel for the headset/collab server
        //================================================
        this._serverAddressInput = $('input.ia-server-address');
        this._serverAddressInput.change(() => this.reconnectToLobby());
        this._passwordModal = $('#pw-input-modal');
        
        $('.ia-reconnect-btn').click(() => this.reconnectToLobby());
        
        $('#ia-server-select .dropdown-item').click(e => this._handleServerSelectDropdown(e))
        
        this._connectBtn = $('.ia-connect-btn');
        this._connectBtn.click(e => this._handleConnectBtn());
        
        $('#pw-input-modal .btn-primary').click(e => this._submitRoomPassword());

        this._roomSettingsPanel = $('.room-settings');

        this._connectStatusText = $('.ia-connect-status-value');

        //================================================
        // Controls for selecting/adding/removing IA visualizations in the headset
        //================================================
        this._vizSelect = $('#ia-viz-select');
        this._vizSelect.find('button').click(e => this._updateVisualizationsSelect());
        
        this._newVizBtn = $('#ia-new-viz');
        this._newVizBtn.click(() => this.newViz());
        
        this._removeVizBtn = $('#ia-remove-viz');
        this._removeVizBtn.click(() => this.removeSelectedViz());

        //================================================
        // Controls and info about the currently selected IA viz
        //================================================
        this._vizInfoSections = $(".ia-viz-info");

        // Set visualization name
        this._vizNameText = $('.ia-viz-name');
        this._vizNameInput = $('input.ia-viz-name');
        this._vizNameInput.change(() => this.setSelectedVizName(this._vizNameInput.val()));

        // Dropdown to select a datasource
        this._dataSourceSelect = $('#ia-datasource-select');
        this._dataSourceSelect.find('button').click(e => this._updateDataSourcesSelect());

        // The Axis=>Variable mappings table for configuring high-dimensional visualizations
        this._axisMappingsPanel = $('#ia-axis-mappings');
        this._axisMappingsTable = this._axisMappingsPanel.find('table')
            .DataTable({
                paging: false,
                ordering: false,
                info: false,
                columns: [
                    // {
                    //     data: 'enabled',
                    //     render: $this._getMappingEnabledCell
                    // },
                    {
                        data: 'name'
                    },
                    {
                        data: 'mapping',
                        render: function(data) {
                            return $this._getAxisMappingCell(data);
                        }
                    },
                ],
                language: {
                    emptyTable: "Please select a visualization"
                }
            });

        this._axisMappingsPanel.find('tbody')
            .on('click',
                '.dropdown.ia-axis-mapping button',
                e => {
                    let dropdown = $(e.target).parents('.dropdown');
                    var axis = $this._axisMappingsTable.row(dropdown.parents('tr')).data();
                    $this._updateVariableSelect(dropdown, axis.name);
                });

        // Viz point size
        this._pointSizeSlider = $('input.ia-point-size')
            .on('input change', e => {
                let value = parseFloat($(e.target).val());
                if (isFinite(value))
                    $this.ia.Scene.VizSettings.GetOrCreate().PointSize.Set(value);
            })

        // Viz colormap
        this._colormapSelect = $('.dropdown.ia-viz-colormap');
        this._colormapSelect.find('button')
            .click(e => $this._updateColormapSelect());


        //When a change in the IA Scene is detected
        this.ia.Scene.OnChanged(e => {
            // Needed to update the point size slider
            // When the user changes point size from within the headset
            if (e.sourceModel.modelType == 'VizSettings') {
                $this._updateSelectedVizInfo();
            }
        });

        //================================================
        // Initialize the Tableau integration layer
        //================================================
        this.integration.init(this.ia);

        // Initialize the states of UI controls to <no visualization selected>
        this._updateSelectedVizInfo();
    }

    /** Reconnect to the IA Runtime Lobby Server URI entered in the server address input */
    reconnectToLobby()
    {
        console.log("Reconnect to lobby");
        
        let address = this._serverAddressInput.val();

        /* If this URI is a collab Room server rather than Lobby server,
        * the IA runtime API will detect that and reconnect to it as
        * a room server
        */
        this.ia.LobbyServerUri = address;
    }

    /** Update connection-related UI components when the IA Runtime connection state changes
     * Disable room settings inputs if already connected to a room
     */
    _handleStateChanged(state) {
        let statusMessage = this.ia.ConnectionStatusMessage;
        console.log("State changed: " + statusMessage.message);
        console.log(statusMessage);
        this._connectStatusText.text(statusMessage.message);
        this._connectStatusText.css('color', IA.util.iacolor_to_css(statusMessage.color));

        let joiningOrJoinedRoom = this._isJoiningOrJoinedRoom();
        
        this._connectBtn.text(joiningOrJoinedRoom ? "Disconnect from Room" : "Create or Join Room");

        this._connectBtn.prop('disabled', state == "Disconnected" || state == "ConnectingToLobby" || state == "Disconnecting");

        this._roomSettingsPanel.find(':input').prop('disabled', joiningOrJoinedRoom);
        this._roomSettingsPanel.find('td').toggleClass('text-muted', joiningOrJoinedRoom);
    }
    
    _isJoiningOrJoinedRoom() {
        let state = this.ia.ConnectionState;
        return state == "JoiningRoom" || state == "JoinedRoom";
    }

    /** Handle user selecting an IA room or lobby server
     */
    _handleServerSelectDropdown(e) {
        let server = $(e.target).text();
        this._serverAddressInput.val(server);
        this.reconnectToLobby();
    }


    /** Create Room/Disconnect button logic */
    _handleConnectBtn() {
        if (this._isJoiningOrJoinedRoom())
            this.ia.Disconnect();
        else
        {
            let roomName = $('input.ia-room-name').val();
            this.ia.JoinOrCreateRoom(roomName);
        }
    }

    /** If the room we are trying to join requires a password, display a
     * popup dialog allowing the user to enter the password.
     */
    _handleRoomPasswordRequired(uri, msg) {
        this._lastRoomPasswordUri = uri;
        this._passwordModal.find(".pw-msg").text(msg.details);
        this._passwordModal.modal();
    }


    /** Send room password entered in the room password dialog to the IA Runtime API */
    _submitRoomPassword() {
        let pw = $('#pw-input-modal pw-input').val();
        this.ia.ProvideRoomPassword(this._lastRoomPasswordUri, pw);
        this._passwordModal.modal('hide');
    }

    _handleRoomConnectionReady() {
        console.log("Room connection is ready!");
    }

    /** Update the dropdown menu of visualizations in the IA Runtime Scene */
    _updateVisualizationsSelect() {
        let $this = this;
        let menu = this._vizSelect.find('.dropdown-menu');
        menu.empty();

        this.ia.Scene.Visualizations.Keys
            .forEach(function(name) {
                makeDropdownItem(name, () => $this.selectViz(name))
                    .appendTo(menu);
            });
    }

    /** Update the data sources dropdown menu with
     * [<Existing tables in the IA Scene.Database] and
     * [<Available Tableau Worksheet Logical Tables>]
     */
    _updateDataSourcesSelect() {
        let $this = this;
        let menu = this._dataSourceSelect.find('.dropdown-menu');
        menu.empty();

        // cancel any previous operations retrieving the datasource list
        if (this._cancelToken)
            this._cancelToken.cancelled = true;
        let cancelToken = this._cancelToken = { cancelled : false }

        this.ia.Scene.Database.Tables.Keys.forEach(tableName => {
            let dataSrc = { name: tableName };
            menu.append($this._getDataSourceMenuItem(dataSrc));
        });

        this._pendingDataSources = this.integration.getDataSourcesAsync();

        // TODO add loading spinner while waiting

        this._pendingDataSources.then(dataSources => {
            if (cancelToken.cancelled)
                return;

            dataSources.forEach(dataSrc => {
                menu.append($this._getDataSourceMenuItem(dataSrc));
            });
        })
    }

    _getDataSourceMenuItem(dataSrc) {
        let $this = this;
        return makeDropdownItem(
                dataSrc.name,
                e => $this.setCurrentVisualizationDataSource(dataSrc));
    }

    /** Create an IA table for `dataSrc` and set it as the data source
     * for the currently selected visualization
     * @param dataSrc
     *     name: Displayed name
     *     type: data source type ('tableau' for Tableau worksheet Logical Tables)
     *     logicalTableId: Tableau logical table ID
     *
     */
    setCurrentVisualizationDataSource(dataSrc) {
        console.log("Set Data Source: " + dataSrc.name);
        let viz = this.getSelectedViz();
        if (!viz)
            return;
        
        viz.PrimaryAxes.TableName = dataSrc.name;
        this.integration.createTableForDataSource(dataSrc);
    }

    /** Select a Visualization by name.
     * Also selects this Visualization in the IA Runtime Scene.
     */
    selectViz(vizName) {
        if (vizName == this._selectedVizName)
            return;

        if (this._unregisterSelectedVizListener)
            this._unregisterSelectedVizListener();
        
        this._selectedVizName = vizName;
        
        let viz = this.getSelectedViz();
        if (viz)
        {
            this._unregisterSelectedVizListener = viz.OnChanged(e => this._updateSelectedVizInfo(false, e));

            // Update Scene selection to follow this selection
            this.ia.Scene.Selection.SetSingleValue(viz);
        }
        this._updateSelectedVizInfo(true);
    }

    /** Shortcut to retrieve the selected Visualizations from the internally stored name reference */
    getSelectedViz() {
        return this.ia.Scene.Visualizations.Get(this._selectedVizName);
    }

    /** Update UI displaying info for the selected IA Visualizations */
    _updateSelectedVizInfo(fullRefresh, event) {
        let viz = this.getSelectedViz();
        let vizName = viz ? viz.Name : '';
        let vizLabel = viz ? viz.Name : '<No Visualization Selected>';
        console.log('Updating Info For Visualization: ' + vizLabel);

        // Disable form fields and labels
        this._vizInfoSections.find(':input').prop('disabled', !viz);
        this._vizInfoSections.toggleClass('text-muted', !viz);

        this._vizNameInput.val(vizName);
        this._vizNameText.text(vizLabel);    // Non-inputs should display a 'null' message
        
        let tableName = viz ? viz.PrimaryAxes.TableName : '';
        this._dataSourceSelect.find('button').text(tableName ? tableName : "<Select Data Source>");

        this._pointSizeSlider.val(this.ia.Scene.VizSettings.GetOrCreate().PointSize.Value);

        let colormapName = viz ? viz.ColormapName.Value : "<Colormap>";
        this._colormapSelect.find('button').text(colormapName)
        
        this._updateMappings(viz, fullRefresh);
    }

    /** Refresh data in the  Axis=>Variable mappings table */
    _updateMappings(viz, fullRefresh) {
        if (!viz)
        {
            this._axisMappingsTable.clear().draw();
            return;
        }

        let primaryAxes = viz.PrimaryAxes;

        let axes = fullRefresh
            ? primaryAxes.Config.axes
            : this._axisMappingsTable.rows().data();

        for (let i=0; i<axes.length; i++)
        {
            let axis = axes[i];
            let mapping = primaryAxes.GetMapping(axis.name);
            axis.enabled = mapping ? mapping.enabled : false;
            axis.mapping = mapping ? mapping.variableName : "";
        }

        this._axisMappingsTable
            .clear()
            .rows.add(axes)
            .draw();
    }

    /** Create a toggle cell to enable/disable the current Axis=>Variable mapping */
    _getMappingEnabledCell(enabled) {
        let icon = enabled ? 'ion-eye' : 'ion-eye-disabled';
        return `<button class='enable-axis btn icon-btn'><i class='icon ${icon}'></i></button>`;
    }

    /** AxisMappings table:
     * Create a new cell for the 'Variable' column, displaying a
     * dropdown menu to select which variable this Axis displays.
     */
    _getAxisMappingCell(axisMapping) {
        return `<div class="dropdown ia-axis-mapping">
                    <button class="btn btn-block dropdown-toggle" aria-expanded="false" data-toggle="dropdown" type="button">
                        ${axisMapping ? axisMapping : ""}
                    </button>
                    <div class="dropdown-menu"></div>
                </div>`;
    }

    /** Update a dropdown menu of available data source columns/variables
     * based on the currently referenced table
     */
    _updateVariableSelect(variableSelect, axisName) {
        let menu = variableSelect.children('.dropdown-menu');
        menu.empty();

        makeDropdownItem('&lt;Unmapped&gt;', e => viz.ClearMapping(axisName))
            .appendTo(menu);

        let viz = this.getSelectedViz();
        if (!viz)
            return;

        let table = this.ia.Scene.Database.Tables.Get(viz.PrimaryAxes.TableName);

        if (!table)
            return;


        table.Columns.Keys.forEach(column => {
                makeDropdownItem(column, () => viz.MapAxis(axisName, column))
                    .appendTo(menu);
            });
    }

    /** Update the dropdown menu of available colormaps */
    _updateColormapSelect() {
        let menu = this._colormapSelect.find('.dropdown-menu');
        menu.empty();

        let viz = this.getSelectedViz();
        if (!viz)
            return;

        this.ia.Scene.Colormaps.AvailableColormapNames
            .forEach(name => {
                makeDropdownItem(name, () => {
                        viz.ColormapName.Set(name);
                    })
                    .appendTo(menu);
            });
    }

    /** Create a new IA Visualization with default settings */
    newViz() {
        console.log("Create new visualization");
        let vizName = this._getUniqueVisualizationName();
        let viz = this.ia.create.ScatterViz(vizName);
        this.ia.Scene.Visualizations.Add(viz);
        this.selectViz(viz.Name);
    }

    /** Removes the selected viz from the scene */
    removeSelectedViz() {
        console.log("Remove visualization: " + this._selectedVizName);
        if (this._selectedVizName)
            this.ia.Scene.Visualizations.RemoveKey(this._selectedVizName);
    }

    /** Find the next available default name for a new Visualization */
    _getUniqueVisualizationName() {
        let vizs = this.ia.Scene.Visualizations;
        
        let baseName = "New Visualization";
        if (!vizs.ContainsKey(baseName))
            return baseName;
        
        baseName = baseName + " ";
        
        for (let i=1; i<1000; i++)
        {
            let name = baseName + i;
            if (!vizs.ContainsKey(name))
                return name;
        }
        throw "Too many visualizations";
    }

    /** When the IA.Scene.Visualizations list changes,
     * select the first viz if none are currently selected
     */
    _handleVizListChanged() {
        let viz = this.getSelectedViz();
        if (viz)
            return;

        let vizs = this.ia.Scene.Visualizations;
        this.selectViz(vizs.Keys[0]);  // select first visualization by default
    }

    /** Sets the Name property for the selected IA Visualization */
    setSelectedVizName(name) {
        if (!name)
            return;
        
        // Cancel if a plot already has this name
        if (this.ia.Scene.Visualizations.ContainsKey(name))
            return;
        
        let viz = this.getSelectedViz();
        if (viz)
        {
            viz.Name = name;
            this._selectedVizName = name;
            console.log("Todo rename listener");
        }
    }
}


/**
 * Integration layer binding Tableau Dashboard Extension API to Immersion Analytics Runtime API.
 * Retrieves list of datasources and creates IATableauDataSourceBindings between
 * Tableau Worksheet LogicalTables and IA data tables.
 */
class IAExtTableauIntegration {
    constructor() {
        this._tableBindings = {}
    }

    /** Initialize the Tableau dashboard extension API.
     * Ensure the bindings list is updated any time a new IA table is added or removed
     * in the IA runtime Database
     */
    init(ia) {
        let $this = this;
        this.ia = ia;
        this.database = ia.Scene.Database;

        console.log("Initializing Tableau JS");
        tableau.extensions.initializeAsync().then(function() {
            console.log("Tableau JS Initialized");
            
            $this.database.Tables.OnChanged(() => $this._updateBindings());
        });
        
        this._updateBindings();
    }

    /**
     * Create a new IA table based on data source metadata.
     * @dataSrc.name is used for the IA table name.
     * @dataSrc.type is recorded to the IA table's SourceType property.
     * Any additional properties are written as json to the IA table's SourceInfo property
     */
    createTableForDataSource(dataSrc) {
        let tableName = dataSrc.name;
        let table = this.database.Get(tableName);
        
        if (!table)
        {
            table = this.ia.create.IADataTable(tableName)
            this.database.Tables.Add(table);
        }
        
        // Return early if table is already bound to this worksheet
        if (table.SourceType == IATableauSourceType)
        {
            let srcInfo = parseJSON(table.SourceInfo);
            if (srcInfo && srcInfo.worksheetName == dataSrc.worksheetName)
                return;
        }

        table.SourceType = dataSrc.type;

        delete dataSrc.name;
        delete dataSrc.type;

        // Write any remaining properties to SourceInfo as JSON
        table.SourceInfo = $.isEmptyObject(dataSrc) ? "" : JSON.stringify(dataSrc);

        this._updateBindings();
        // TODO handle SourceType or SourceInfo change callback
    }

    /**
     * Process the list of data tables in the IA runtime and create Tableau bindings for any
     * whose source type is equal to `IATableauSourceType`
     */
    _updateBindings() {
        let tables = this.database.Tables;
        tables.Keys.forEach(name => {
            console.log("Processing table " + name);
            let table = tables[name];
            
            // check if binding already exists
            if (this._tableBindings[name])
                return;
            
            let srcType = table.SourceType;
            if (srcType != IATableauSourceType)
                return;
            
            let src = parseJSON(table.SourceInfo);
            if (!src || !src.worksheetName)
                return;

            let worksheet = this._getTableauWorksheet(src.worksheetName);
            if (!worksheet)
            {
                console.log("Worksheet '" + src.worksheetName + "' does not exist in this Tableau dashboard");
                return;
            }

            if (!src.logicalTableId)
            {
                console.log("  => No logical table Id specified")
                return;
            }

            let binding = new IATableauDataSourceBinding(worksheet, src.logicalTableId, this.ia, table)
            this._tableBindings[table.Name] = binding;
            
            // TODO handle table or worksheet renaming
        });
    }

    /** Compile all Worksheet LogicalTables available in this dashboard */
    getDataSourcesAsync() {
        return Promise.all(
            tableau.extensions.dashboardContent.dashboard.worksheets
                .map(this._getDataSourcesForWorksheetAsync))
            .then(dataSources => [].concat(...dataSources));        // Flatten the array of per-worksheet datasource arrays
    }

    /** Create metadata object for each LogicalTable in this worksheet */
    _getDataSourcesForWorksheetAsync(worksheet) {
        return worksheet.getUnderlyingTablesAsync()
            .then(tables => tables.map(table => {
                return {                                // build a data source info object for each logical table in the worksheet
                    name : worksheet.name + '/' + table.id,
                    type : IATableauSourceType,
                    worksheetName : worksheet.name,
                    logicalTableId : table.id
                };
            }));
    }

    _getTableauWorksheet(sheetName) {
        // Go through all the worksheets in the dashboard and find the one we want
        return tableau.extensions.dashboardContent.dashboard.worksheets.find(function(sheet) {
            return sheet.name === sheetName;
        });
    }
}

/** Source Type identifier applied to IA tables bound to Tableau data sources  */
const IATableauSourceType = 'tableau';

/** Like JSON.parse(), but does not throw an exception */
function parseJSON(jsonStr) {
    try {
        return JSON.parse(jsonStr);
    }
    catch {
        return null;
    }
}

/**
 * Binds a Tableau LogicalTable to an IA Data Table.
 * Listens for selection or filter changes in the tableau worksheet, then reloads
 * worksheet data for the bound LogicalTable and applies it to the bound IA Data Table
 */
class IATableauDataSourceBinding {
    // TODO dispose this, or don't update when a table is not currently referenced?
    
    constructor(tableauWorksheet, logicalTableId, ia, table)
    {
        this.worksheet = tableauWorksheet;
        this.tableId = logicalTableId;
        this.table = table;
        this._unregisterListenerFunctions = [];
        console.log("Initializing data binding for " + table.Name);
        this.updateData();
    }

    /** Unregister selection+filter change listener */
    _unregisterListeners() {
        this._unregisterListenerFunctions.forEach(unregister => unregister());
        this._unregisterListenerFunctions = [];
    }

    /** Register worksheet selection and filter change listeners */
    _registerListeners() {
        let $this = this;

        this._unregisterListenerFunctions.push(this.worksheet.addEventListener(
            tableau.TableauEventType.MarkSelectionChanged,
            () => $this.updateData()));

        this._unregisterListenerFunctions.push(this.worksheet.addEventListener(
            tableau.TableauEventType.FilterChanged,
            () => $this.updateData()));
    }

    /** When the Tableau Worksheet data table changes, this method pulls the updated dataset and sends
     * it to the IA data table/Visualization
     */
    updateData() {
        this._unregisterListeners();

        let $this = this;

        let options = {
            includeAllColumns:true,     // We want to make all columns available to Visualize // TODO only load columns which have been mapped to an axis
            maxRows: 2000       // AM DEBUGGING We get browser memory errors if too many rows are loaded
        };
        this.worksheet.getUnderlyingTableDataAsync(this.tableId, options)
            .then(table => $this.setTableData(table))
            .then(() => $this._registerListeners())
    }

    /** Convert Tableau Worksheet data into IA data table format, and apply to the bound IA Data Table */
    setTableData(worksheetData) {
        console.log("Data table update: " + this.table.Name);
        
        let dataRows = worksheetData.data;

        let columns = worksheetData.columns.map(function(column) {
            let type = Tableau2IADataTypeLookup[column.dataType];
            if (!type)
                return null;
            
            let index = column.index;
            
            return {
                name : column.fieldName,
                type : type,
                data : dataRows.map(row => row[index].nativeValue)
            }
        });
        
        let table = {
            name : this.worksheet.name,
            columns : columns.filter(c => c)    // remove null columns
        }
        
        this.table.SetData(table);
    }
    
}

/** Create a basic html dropdown menu item */
function makeDropdownItem(name, callback) {
    return $(`<a class='dropdown-item' href="#">${name}</a>`)
        .click(callback);
}


/** Lookup for translating Tableau column data types to equivalent IA column types */
Tableau2IADataTypeLookup = {
    'bool' : 'int',
    'float' : 'float',
    'int' : 'int',
    'date' : 'timestamp',
    'date-time' : 'timestamp',
    'string' : 'string',
    'spatial' : null,
}

console.log("Running IA script");

/** Once the Immersion Analytics Runtime library is ready, init the extension logic */
IA.OnReady(() => {
    console.log("IA ready");
    jQuery(function($) {
        window.$ = $;
        window.ia_ext = new IAExt(new IAExtTableauIntegration());
    });
});
