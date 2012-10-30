/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */


/* It's very easy to accidentally leave in a console.log if you're
 * working with Firebug, but this will break CATMAID for the majority
 * of browsers.  If window.console isn't defined, create a noop
 * version of console.log: */

if (!window.console) {
  window.console = {};
  window.console.log = function() {}
}

var global_bottom = 34;
var statusBar; //!< global statusBar
var slider_trace_z;
var slider_trace_s;
var a_url; //!< URL to this page

var input_fontsize; //!< fontsize input
var input_fontcolourred; //!< fontcolour red input
var input_fontcolourgreen; //!< fontcolour green input
var input_fontcolourblue; //!< fontcolour blue input
var ui;
var requestQueue;
var project;
var project_view;
var projects_available;
var projects_available_ready = false;

var project_menu;
var project_menu_open;
var project_menu_current;

var message_menu;

var pid;
var sids = new Array();
var ss = new Array();
var zp;
var yp;
var xp;
var inittool;
var init_active_skeleton;
var init_active_node_id;

var session;
var msg_timeout;
var MSG_TIMEOUT_INTERVAL = 60000; //!< length of the message lookup interval in milliseconds
var messageWindow = null;

var rootWindow;

var user_permissions = null;
function checkPermission(p) {
  return user_permissions && user_permissions[project.getId()][p];
}
function mayEdit() {
  return checkPermission('can_edit_any');
}

function mayView() {
  return checkPermission('can_view_any');
}

// From: http://stackoverflow.com/q/956719/223092
function countProperties(obj) {
  var count = 0;
  for(var prop in obj) {
    if(obj.hasOwnProperty(prop))
      ++count;
  }
  return count;
}

// url of the django instance relative to the CATMAID URL
// (if any, needed e.g. by cropping tool). It is expected
// to end with a slash.
var django_url = "dj/"

/**
 * queue a login-request on pressing return
 * to be used as onkeydown-handler in the account and password input fields
 */

function login_oninputreturn(e) {
  if (ui.getKey(e) == 13) {
    login(document.getElementById("account").value, document.getElementById("password").value);
    return false;
  } else
  return true;
}

/**
 * queue a login-request optionally using account and password,
 * freeze the window to wait for an answer
 *
 * if account or password are set, a new session is instantiated or an error occurs
 * if account and password are not set, an existing session is tried to be recognised
 */

function login(
		account,		//!< string account
		password,		//!< string password
		completionCallback	//!< function callback
)
{
	var loginCompletion = function ( status, text, xml ) {
		handle_login( status, text, xml, completionCallback );
	}
	if ( msg_timeout ) window.clearTimeout( msg_timeout );
	
	ui.catchEvents( "wait" );
	if ( account || password )
		requestQueue.register(
			'model/login.php',
			'POST',
			{ name : account, pwd : password },
			loginCompletion );
	else
		requestQueue.register(
			'model/login.php',
			'GET',
			undefined,
			loginCompletion );
	return;
}

/**
 * handle a login-request answer
 * if the answer was session data, establish a session, update the projects menu
 * if the answer was an error, display an error alert,
 * if the answer was a notice, do nothing
 *
 * free the window
 */

function handle_login(status, text, xml, completionCallback) {
  if (status == 200 && text) {
    // console.log(text);
    var e = eval("(" + text + ")");

    if (e.id) {
      session = e;
      document.getElementById("account").value = "";
      document.getElementById("password").value = "";
      document.getElementById("session_longname").replaceChild(
      document.createTextNode(e.longname), document.getElementById("session_longname").firstChild);
      document.getElementById("login_box").style.display = "none";
      document.getElementById("logout_box").style.display = "block";
      document.getElementById("session_box").style.display = "block";

      document.getElementById("message_box").style.display = "block";

      document.getElementById("project_menu_new").style.display = "block";

      //msg_timeout = window.setTimeout( message, MSG_TIMEOUT_INTERVAL );
      message();
    } else if (e.error) {
      alert(e.error);
    }
    updateProjects(completionCallback);
  } else if (status != 200) {
    // Of course, lots of non-200 errors are fine - just report
    // all for the moment, however:
    alert("The server returned an unexpected status (" + status + ") " + "with error message:\n" + text);
    if ( typeof completionCallback !== "undefined" ) {
      completionCallback();
    }
  }

  // Whatever happened, get details of which projects this user (or no
  // user) is allowed to edit:
  $.get('model/user-project-permissions.php', function (data) {
    if (data.error) {
      alert(data.error);
    } else {
      user_permissions = data;
    }
  }, 'json');

  return;
}

/**
 * queue a logout-request
 * freeze the window to wait for an answer
 */

function logout() {
  if (msg_timeout) window.clearTimeout(msg_timeout);

  ui.catchEvents("wait");
  requestQueue.register('model/logout.php', 'GET', undefined, handle_logout);

  return;
}

/**
 * handle a logout-request answer
 * update the project menu
 *
 * free the window
 */
function handle_logout()
{
	session = undefined;
	document.getElementById( "login_box" ).style.display = "block";
	document.getElementById( "logout_box" ).style.display = "none";
	document.getElementById( "session_box" ).style.display = "none";
	
	document.getElementById( "message_box" ).style.display = "none";
	
	document.getElementById( "project_menu_new" ).style.display = "none";
			
	updateProjects();
	
	if ( project && project.id ) project.setTool( new Navigator() );
	
	return;
}


/**
 * queue a project-menu-update-request to the request queue
 *
 * the answer depends on the session, which wa sinstantiated by setting a cookie
 */

function updateProjects(completionCallback) {
  //ui.catchEvents( "wait" );
  project_menu_open.update(null);

  document.getElementById("projects_h").style.display = "none";
  document.getElementById("project_filter_form").style.display = "none";

  var pp = document.getElementById("projects_dl");

  while (pp.firstChild) pp.removeChild(pp.firstChild);

  var w = document.createElement("dd");
  w.className = "wait_bgwhite";
  w.appendChild(document.createTextNode("loading ..."));
  pp.appendChild(w);

  requestQueue.register('model/project.list.php',
                        'GET',
                        undefined,
                        function (status, text, xml) {
                        handle_updateProjects(status, text, xml);
                                if (typeof completionCallback !== "undefined") {
                                  completionCallback();
                                }
			});
  return;
}

var cachedProjectsInfo = null;

/**
 * handle a project-menu-update-request answer
 * update the project menu
 *
 * free the window
 */

function handle_updateProjects(status, text, xml) {
  if (status == 200 && text) {
    var e = $.parseJSON(text);

    var keep_project_alive = false;
    var keep_project_editable = false;

    if (e.error) {
      project_menu_open.update();
      alert(e.error);
    } else {
      $('#project_filter_form').show();
      cachedProjectsInfo = e;
      updateProjectListFromCache();
    }
    if (project) {
      if (keep_project_alive) project.setEditable(keep_project_editable);
      else {
        project.destroy();
        delete project;
      }
    }
  }
  ui.releaseEvents();
  return;
}

function updateProjectListMessage(text) {
  $('#project_list_message').text(text);
}

/**
 * Do a delayed call to updateProjectListFromCache() and indicate
 * the progress.
 */
var cacheLoadingTimeout = null;
function updateProjectListFromCacheDelayed()
{
  // indicate active filtered loading of the projects
  var indicator = document.getElementById("project_filter_indicator");
  window.setTimeout( function() { indicator.className = "filtering"; }, 1);

  // clear timeout if already present and create a new one
  if (cacheLoadingTimeout != null)
  {
    clearTimeout(cacheLoadingTimeout);
  }
  cacheLoadingTimeout = window.setTimeout(
    function() {
      updateProjectListFromCache();
      // indicate finish of filtered loading of the projects
      indicator.className = "";
    }, 500);
}

/**
 * Update the displayed project list based on the cache
 * entries. This can involve a filter in the text box
 * "project_filter_text".
 */
function updateProjectListFromCache() {
  var matchingProjects = 0,
      searchString = $('#project_filter_text').val(),
      display,
      re = new RegExp(searchString, "i"),
      title,
      toappend,
      i, j, k,
      dt, dd, a, ddc,
      p,
      catalogueElement, catalogueElementLink,
      pp = document.getElementById("projects_dl");
  // remove all the projects
  while (pp.firstChild) pp.removeChild(pp.firstChild);
  updateProjectListMessage('');
  // maintain a list of projects/sessions available
  projects_available_ready = false;
  if (projects_available)
  {
    delete projects_available;
  }
  projects_available = new Array();
  // add new projects according to filter
  for (i in cachedProjectsInfo) {
    p = cachedProjectsInfo[i];
    display = false;
    toappend = [];
    if (project && project.id == i) {
      keep_project_alive = true;
      keep_project_editable = p.editable;
    }

    dt = document.createElement("dt");

    title = p.title;
    if (re.test(title)) {
      display = true;
    }
    dt.appendChild(document.createTextNode(p.title));

    document.getElementById("projects_h").style.display = "block";
    document.getElementById("project_filter_form").style.display = "block";
    toappend.push(dt);

    projects_available[ p.pid ] = new Array();
    // add a link for every action (e.g. a stack link)
    for (j in p.action) {
      var sid_title = p.action[j].title;
      var sid_action = p.action[j].action;
      var sid_note = p.action[j].comment;
      projects_available[p.pid][j] =
          { title : sid_title, action : sid_action, note : sid_note };
      dd = document.createElement("dd");
      a = document.createElement("a");
      ddc = document.createElement("dd");
      a.href = sid_action;
      if (re.test(sid_title)) {
        display = true;
      }
      a.appendChild(document.createTextNode(sid_title));
      dd.appendChild(a);
      toappend.push(dd);
      if (sid_note) {
        ddc = document.createElement("dd");
        ddc.innerHTML = sid_note;
        toappend.push(ddc);
      }
    }
    // optionally, add a neuron catalogue link
    if (p.catalogue) {
      catalogueElement = document.createElement('dd');
      catalogueElementLink = document.createElement('a');
      catalogueElementLink.href = 'dj/' + p.pid;
      catalogueElementLink.appendChild(document.createTextNode('Browse the Neuron Catalogue'));
      catalogueElement.appendChild(catalogueElementLink);
      toappend.push(catalogueElement);
    }
    if (display) {
      ++ matchingProjects;
      for (k = 0; k < toappend.length; ++k) {
        pp.appendChild(toappend[k]);
      }
    }
  }
  if (cachedProjectsInfo.length === 0) {
    updateProjectListMessage("No CATMAID projects have been created");
  } else if (matchingProjects === 0) {
    updateProjectListMessage("No projects matched '"+searchString+"'");
  }
  projects_available_ready = true;
  project_menu_open.update(cachedProjectsInfo);
}

/**
 * queue an open-project-stack-request to the request queue
 * freeze the window to wait for an answer
 */
function openProjectStack( pid, sid )
{
	if ( project && project.id != pid )
	{
		project.destroy();
	}
	ui.catchEvents( "wait" );
	requestQueue.register(
		'model/project.stack.php',
		//'dj/' + pid + '/stack/' + sid + '/info',
		'POST',
		{ pid : pid, sid : sid },
        // {},
		handle_openProjectStack );
	return;
}

/**
 * handle an open-project-stack-request answer
 * open the project or, if already opened, add the stack to the opened project
 *
 * free the window
 */
function handle_openProjectStack( status, text, xml )
{

	if ( status == 200 && text )
	{
		var e = eval( "(" + text + ")" );
		if ( e.error )
		{
			alert( e.error );
		}
		else
		{
			//! look if the project is already opened, otherwise open a new one
			if ( !( project && project.id == e.pid ) )
			{
				project = new Project( e.pid );
				project_view = project.getView();
				project.register();
			}
			
			project.setEditable( e.editable );

			var labelupload = '';

			if( e.hasOwnProperty('labelupload_url') && e.tile_source_type === 2 ) {
				labelupload = e.labelupload_url;
			}

			var stack = new Stack(
					project,
					e.sid,
					e.stitle,
					e.dimension,
					e.resolution,
					e.translation,		//!< @todo replace by an affine transform
					e.broken_slices,
					e.trakem2_project,
					e.num_zoom_levels,
					-2,
					e.tile_source_type,
					labelupload, // TODO: if there is any
					e.metadata,
					e.inverse_mouse_wheel);

			document.getElementById( "toolbox_project" ).style.display = "block";
			
			var tilelayer = new TileLayer(
					stack,
					e.image_base,
					e.tile_width,
					e.tile_height,
					e.file_extension,
					e.tile_source_type);

			stack.addLayer( "TileLayer", tilelayer );

			$.each(e.overlay, function(key, value) {
				var tilelayer2 = new TileLayer(
								stack,
								value.image_base,
								e.tile_width,
								e.tile_height,
								e.file_extension,
								e.tile_source_type);
				// set default opacity internally
				tilelayer2.setOpacity( value.default_opacity );
				stack.addLayer( value.title, tilelayer2 );
				stack.overviewlayer.setOpacity( value.title,  value.default_opacity );
			});


			project.addStack( stack );

			if ( inittool === 'tracingtool' ) {
			  project.setTool( new TracingTool() );
			} else if ( inittool === 'navigator' ) {
			  project.setTool( new Navigator() );
			} else if ( inittool === 'canvastool' ) {
        project.setTool( new CanvasTool() );
      }

			//! if the stack was initialized by an URL query, move it to a given position
			if ( pid == e.pid && sids.length > 0 )
			{
				for ( var i = 0; i < sids.length; ++i )
				{
					if ( sids[ i ] == e.sid )
					{
						if (
							typeof ss[ i ] == "number" &&
							typeof zp == "number" &&
							typeof yp == "number" &&
							typeof xp == "number" )
						{
							project.moveTo( zp, yp, xp );
							stack.moveToPixel( stack.z, stack.y, stack.x, ss[i] );

							sids.splice( i, 1 );
							ss.splice( i, 1 );
							break;
						}
					}
				}
			}

            if( init_active_skeleton || init_active_skeleton ) {
                window.setTimeout("SkeletonAnnotations.staticSelectNode(init_active_node_id, init_active_skeleton)", 2000);
            }


			/* Update the projects "current project" menu. If there is more
			than one stack linked to the current project, a submenu for easy
			access is generated. */
			project_menu_current.update();
			var stacks = projects_available[project.id];
			if (stacks.length > 1)
			{
				var current_menu_content = new Array();
				for (var s in stacks)
				{
					current_menu_content[ s ] =
						{
							id : s,
							title : stacks[s].title,
							note : stacks[s].note,
							action : stacks[s].action
						}
				}
				project_menu_current.update( current_menu_content );
				document.getElementById( "project_menu_current" ).style.display = "block";
			}
		}
	}
	ui.releaseEvents();
	return;
}

/**
 * look for user messages
 */

function message() {
  requestQueue.register('model/message.list.php', 'GET', undefined, handle_message);
  return;
}

/**
 * handle a user message
 */
function handle_message( status, text, xml )
{
	if ( !session )
		return;
	
	if ( status == 200 && text )
	{
		var e = eval( "(" + text + ")" );
		if ( e.error )
		{
			alert( e.error );
		}
		else
		{
			var message_container = document.getElementById( "message_container" );
			if ( !( typeof message_container == "undefined" || message_container == null ) )
			{
				//! remove old messages	
				while ( message_container.firstChild ) message_container.removeChild( message_container.firstChild );
				
				//! add new messages
				var n = 0;
				for ( var i in e )
				{
					e[ i ].action = "model/message.read.php?id=" + e[ i ].id;
					e[ i ].note = e[ i ].time_formatted;
					++n;
					var dt = document.createElement( "dt" );
					dt.appendChild( document.createTextNode( e[ i ].time_formatted ) );
					var dd1 = document.createElement( "dd" );
					var dd1a = document.createElement( "a" );
					dd1a.href = e[ i ].action;
					dd1a.appendChild( document.createTextNode( e[ i ].title ) );
					dd1.appendChild( dd1a );
					var dd2 = document.createElement( "dd" );
					dd2.innerHTML = e[ i ].text;
					message_container.appendChild( dt );
					message_container.appendChild( dd1 );
					message_container.appendChild( dd2 );
				}
				message_menu.update( e );
				if ( n > 0 ) document.getElementById( "message_menu_text" ).className = "alert";
				else document.getElementById( "message_menu_text" ).className = "";
			}
		}
	}
	
	msg_timeout = window.setTimeout( message, MSG_TIMEOUT_INTERVAL );
	
	return;
}

/**
 * update the lists of users
 */

function updateUsers() {
  document.getElementById("new_project_form").elements[3].style.display = "none";
  document.getElementById("new_project_owners_wait").style.display = "block";
  requestQueue.register('model/user.list.php', 'GET', undefined, handle_updateUsers);
  return;
}

/**
 * handle a lists of users update response
 */

function handle_updateUsers(status, text, xml) {
  if (!session) return;

  if (status == 200 && text) {
    var e = eval("(" + text + ")");
    if (e.error) {
      alert(e.error);
    } else {
      var new_project_owners = document.getElementById("new_project_form").elements[3];
      while (new_project_owners.length > 0)
      new_project_owners.remove(0);
      for (var i in e) {
        var option = document.createElement("option");
        option.text = e[i].longname;
        option.value = e[i].id;
        if (e[i].id == session.id) {
          option.selected = true;
        }
        new_project_owners.appendChild(option);
      }
      new_project_owners.size = e.length;

    }
  }
  document.getElementById("new_project_owners_wait").style.display = "none";
  document.getElementById("new_project_form").elements[3].style.display = "block";

  return;
}

/**
 * mark a message as read
 */

function read_message(id) {
  requestQueue.register('model/message.read.php', 'POST', {
    id: id
  }, null);
  return;
}

/*
 * resize the view and its content on window.onresize event
 */
function global_resize( e )
{
	var top = document.getElementById( "toolbar_container" ).offsetHeight;
	var height = Math.max( 0, ui.getFrameHeight() - top - global_bottom );
	var width = ui.getFrameWidth();
	
	var content = document.getElementById( "content" );
	content.style.top = top + "px";
	content.style.width = width + "px";
	content.style.height = height + "px";

	return true;
}

function init() {
  $.get('model/migrate-db.php', function(data) {
    if (data.error) {
      alert(data.error);
    } else {
      realInit();
    }
  }, 'json');
}

/**
 * initialise everything
 * to be called by the onload-handler of document.body
 */
var realInit = function()
{
	//! set some non standard attributes
	/*
	document.body.oncontextmenu = function( e ){ return false; };
	document.body.onselectstart = function( e ){ return false; };
	document.body.ondragstart = function( e ){ return false; };
	*/
	
	//! analyze the URL
	var z;
	var y;
	var x;
	var s;
  
	var account;
	var password;
	
	var values = parseQuery();
	if ( values )
	{
		// simply parse the fragment values
		// @todo take care for the values proper range
		if ( values[ "z" ] ) z = parseInt( values[ "z" ] );
		if ( isNaN( z ) ) delete z;
		if ( values[ "y" ] ) y = parseInt( values[ "y" ] );
		if ( isNaN( y ) ) delete y;
		if ( values[ "x" ] ) x = parseInt( values[ "x" ] );
		if ( isNaN( x ) ) delete x;
		if ( values[ "s" ] ) s = parseInt( values[ "s" ] );
        if ( isNaN( s ) ) delete s;
        if ( values[ "active_skeleton_id" ] ) init_active_skeleton = parseInt( values[ "active_skeleton_id" ] );
        if ( values[ "active_node_id" ] ) init_active_node_id = parseInt( values[ "active_node_id" ] );

		if ( !(
				typeof z == "undefined" ||
				typeof y == "undefined" ||
				typeof x == "undefined" ||
				typeof s == "undefined" ) )
		{
			pid = 1;
			sids = new Array();
			sids[ 0 ] = 1;
			ss = new Array();
			ss[ 0 ] = 1;
		}
		else
		{
			if ( values[ "pid" ] ) pid = parseInt( values[ "pid" ] );
			if ( isNaN( pid ) ) delete pid;
			if ( values[ "zp" ] ) zp = parseInt( values[ "zp" ] );
			if ( isNaN( z ) ) delete zp;
			if ( values[ "yp" ] ) yp = parseInt( values[ "yp" ] );
			if ( isNaN( y ) ) delete yp;
			if ( values[ "xp" ] ) xp = parseInt( values[ "xp" ] );
			if ( isNaN( x ) ) delete xp;
			if ( values[ "tool" ] ) inittool = values[ "tool"];
			
			for ( var i = 0; values[ "sid" + i ]; ++i )
			{
				sids.push( parseInt( values[ "sid" + i ] ) );
				if ( values[ "s" + i ] )
					ss.push( parseInt( values[ "s" + i ] ) );
				else
					ss.push( NaN );
				if ( isNaN( sids[ i ] ) || isNaN( ss[ i ] ) )
				{
					sids.pop();
					ss.pop();
				}
			}
		}
		
		if ( values[ "account" ] && values[ "password" ] )
		{
			account = values[ "account" ];
			password = values[ "password" ];
		}
	}
	
	statusBar = new Console();
	document.body.appendChild( statusBar.getView() );
	
	ui = new UI();
	
	input_fontsize = document.getElementById( "fontsize" );
	
	a_url = document.getElementById( "a_url" );
	a_url.onmouseover = function( e )
	{
		this.href = project.createURL();
		return true;
	}
	
	document.getElementById( "login_box" ).style.display = "block";
	document.getElementById( "logout_box" ).style.display = "none";
	document.getElementById( "session_box" ).style.display = "none";

	// Add the toolbar buttons:

	$('#toolbox_project').replaceWith(createButtonsFromActions(
		toolActions, 'toolbox_project', ''));
	$('#toolbox_edit').replaceWith(createButtonsFromActions(
		editToolActions, 'toolbox_edit', ''));
	$('#toolbox_data').replaceWith(createButtonsFromActions(
		tracingWindowActions, 'toolbox_data', ''));

	document.getElementById( "toolbar_nav" ).style.display = "none";
	document.getElementById( "toolbar_text" ).style.display = "none";
	document.getElementById( "toolbar_crop" ).style.display = "none";
	document.getElementById( "toolbox_project" ).style.display = "none";
	document.getElementById( "toolbox_edit" ).style.display = "none";
	document.getElementById( "toolbox_data" ).style.display = "none";
	document.getElementById( "toolbox_show" ).style.display = "none";
	
	document.getElementById( "account" ).onkeydown = login_oninputreturn;
	document.getElementById( "password" ).onkeydown = login_oninputreturn;
	
	project_menu = new Menu();
	project_menu.update(
		{
			0 :
			{
				title : "New",
				id : "project_menu_new",
				action : function()
				{
					if ( project ) project.destroy();
					document.getElementById( "project list" ).style.display = "none";
					document.getElementById( "new_project_dialog" ).style.display = "block";
					updateUsers();
					return;
				},
				note : ""
			},
			1 :
			{
				title : "Open",
				id : "project_menu_open",
				action : {},
				note : ""
			},
			2 :
			{
				title : "Current",
				id : "project_menu_current",
				action : {},
				note : ""
			}
		}
	);
	document.getElementById( "project_menu" ).appendChild( project_menu.getView() );
	
	project_menu_open = project_menu.getPulldown( "Open" );
	document.getElementById( "project_menu_new" ).style.display = "none";
	//project_menu_open.appendChild( project_menu_open.getView() );
	project_menu_current = project_menu.getPulldown( "Current" );
	document.getElementById( "project_menu_current" ).style.display = "none";

	message_menu = new Menu();
	document.getElementById( "message_menu" ).appendChild( message_menu.getView() );

	//! auto login by url (unsafe as can be but convenient)
	if ( account && password )
		login( account, password );
	else
		login();

	if ( pid && sids.length > 0 )
	{
		// Make sure that the client-side project list is ready before
		// we load the stacks.
		var wait_for_projects = function()
		{
			if ( projects_available_ready )
			{
				for ( var i = 0; i < sids.length; ++i )
				{
					openProjectStack( pid, sids[ i ] )
				}
			}
			else
			{
				setTimeout(wait_for_projects, 10);
			}
		};
		wait_for_projects();
	}
	
	// the text-label toolbar
	
	input_fontsize = new Input( "fontsize", 3, function( e ){ return true; }, 32 );
	document.getElementById( "input_fontsize" ).appendChild( input_fontsize.getView() );
	input_fontcolourred = new Input( "fontcolourred", 3, function( e ){ return true; }, 255 );
	document.getElementById( "input_fontcolourred" ).appendChild( input_fontcolourred.getView() );
	input_fontcolourgreen = new Input( "fontcolourgreen", 3, function( e ){ return true; }, 127 );
	document.getElementById( "input_fontcolourgreen" ).appendChild( input_fontcolourgreen.getView() );
	input_fontcolourblue = new Input( "fontcolourblue", 3, function( e ){ return true; }, 0 );
	document.getElementById( "input_fontcolourblue" ).appendChild( input_fontcolourblue.getView() );
	
	
	/*
	var testLabel = new Textlabel( 1, "This is a textlabel containing some useless text." );
	document.body.appendChild( testLabel.getView() );
	testLabel.redraw( 200, 100, 600, 600 );
	*/
	
	ui.registerEvent( "onresize", global_resize );
	
	rootWindow = new CMWRootNode();
	ui.registerEvent( "onresize", resize );

  // change global bottom bar height, hide the copyright notice
  // and move the statusBar
  statusBar.setBottom();

	window.onresize();

	$('#growl-alert').growlAlert({
					autoShow: false
	});

	return;
}

/**
 * resize the view and its content on window.onresize event
 */
var resize = function( e )
{
	var top = document.getElementById( "toolbar_container" ).offsetHeight;
	var height = Math.max( 0, ui.getFrameHeight() - top - global_bottom );
	var width = ui.getFrameWidth();
	
	var content = document.getElementById( "content" );
	content.style.top = top + "px";
	content.style.width = width + "px";
	content.style.height = height + "px";
	
	rootFrame = rootWindow.getFrame();
	rootFrame.style.top = top + "px";
	rootFrame.style.width = UI.getFrameWidth() + "px";
	rootFrame.style.height = height + "px";
	
	rootWindow.redraw();
	
	return true;
}

function showMessages()
{
	if ( !messageWindow )
	{
		messageWindow = new CMWWindow( "Messages" );
		var messageContent = messageWindow.getFrame();
		messageContent.style.backgroundColor = "#ffffff";
		var messageContext = document.getElementById( "message_context" );
		if ( messageContext.parentNode )
			messageContext.parentNode.removeChild( messageContext );
		messageContent.appendChild( messageContext );
		
		messageWindow.addListener(
			function( callingWindow, signal )
			{
				switch ( signal )
				{
				case CMWWindow.CLOSE:
					if ( messageContext.parentNode )
						messageContext.parentNode.removeChild( messageContext );
					document.getElementById( "dump" ).appendChild( messageContext );
					if ( typeof project == undefined || project == null )
					{
						rootWindow.close();
						document.getElementById( "content" ).style.display = "block";
					}
					messageWindow = null;
					break;
				case CMWWindow.RESIZE:
					messageContext.style.height = messageWindow.getContentHeight() + "px";
					break;
				}
				return true;
			} );
	
		/* be the first window */
		if ( rootWindow.getFrame().parentNode != document.body )
		{
			document.body.appendChild( rootWindow.getFrame() );
			document.getElementById( "content" ).style.display = "none";
		}
		
		if ( rootWindow.getChild() == null )
			rootWindow.replaceChild( messageWindow );
		else
			rootWindow.replaceChild( new CMWVSplitNode( messageWindow, rootWindow.getChild() ) );
	}
			
	messageWindow.focus();
}
