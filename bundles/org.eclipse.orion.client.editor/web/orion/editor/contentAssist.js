/*******************************************************************************
 * @license
 * Copyright (c) 2011, 2014 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*global console define */
/*jslint browser:true */

define("orion/editor/contentAssist", [ //$NON-NLS-0$
	'i18n!orion/editor/nls/messages', //$NON-NLS-0$
	'orion/keyBinding', //$NON-NLS-0$
	'orion/editor/keyModes', //$NON-NLS-0$
	'orion/editor/eventTarget', //$NON-NLS-0$
	'orion/Deferred', //$NON-NLS-0$
	'orion/objects', //$NON-NLS-0$
	'orion/editor/util', //$NON-NLS-0$
	'orion/util', //$NON-NLS-0$
	'orion/webui/littlelib' //$NON-NLS-0$
], function(messages, mKeyBinding, mKeyModes, mEventTarget, Deferred, objects, textUtil, util, lib) {
	/**
	 * @name orion.editor.ContentAssistProvider
	 * @class Interface defining a provider of content assist proposals.
	 */
	/**
	 * @memberOf orion.editor.ContentAssistProvider.prototype
	 * @function
	 * @name computeProposals
	 * @param {String} buffer The buffer being edited.
	 * @param {Number} offset The position in the buffer at which content assist is being requested.
	 * @param {orion.editor.ContentAssistProvider.Context} context
	 * @returns {Object[]} This provider's proposals for the given buffer and offset.
	 */
	/**
	 * @name orion.editor.ContentAssistProvider.Context
	 * @class
	 * @property {String} line The text of the line on which content assist is being requested.
	 * @property {String} prefix Any non-whitespace, non-symbol characters preceding the offset.
	 * @property {orion.editor.Selection} selection The current selection.
	 */

	/**
	 * @name orion.editor.ContentAssist
	 * @class Provides content assist for a TextView.
	 * @description Creates a <code>ContentAssist</code> for a TextView. A ContentAssist consults a set of 
	 * {@link orion.editor.ContentAssistProvider}s to obtain proposals for text that may be inserted into a
	 * TextView at a given offset.<p>
	 * A ContentAssist is generally activated by its TextView action, at which point it computes the set of 
	 * proposals available. It will re-compute the proposals in response to subsequent changes on the TextView 
	 * (for example, user typing) for as long as the ContentAssist is active. A proposal may be applied by calling 
	 * {@link #apply}, after which the ContentAssist becomes deactivated. An active ContentAssist may be deactivated
	 * by calling {@link #deactivate}.<p>
	 * A ContentAssist dispatches events when it becomes activated or deactivated, and when proposals have been computed.
	 * @param {orion.editor.TextView} textView The TextView to provide content assist for.
	 * @borrows orion.editor.EventTarget#addEventListener as #addEventListener
	 * @borrows orion.editor.EventTarget#removeEventListener as #removeEventListener
	 * @borrows orion.editor.EventTarget#dispatchEvent as #dispatchEvent
	 */
	/**
	 * Dispatched when a ContentAssist is about to be activated.
	 * @name orion.editor.ContentAssist#ActivatingEvent
	 * @event
	 */
	/**
	 * Dispatched when a ContentAssist is about to be deactivated.
	 * @name orion.editor.ContentAssist#DeactivatingEvent
	 * @event
	 */
	/**
	 * Dispatched when a ContentAssist has applied a proposal. <p>This event's <code>data</code> field gives information
	 * about the proposal that was applied.
	 * @name orion.editor.ContentAssist#ProposalAppliedEvent
	 * @event
	 */
	/**
	 * Dispatched whenever a ContentAssist has obtained proposals from its providers. <p>This event's
	 * <code>data</code> field gives information about the proposals.
	 * @name orion.editor.ContentAssist#ProposalsComputedEvent
	 * @event
	 */
		
	// INACTIVE --Ctrl+Space--> ACTIVE --ModelChanging--> FILTERING
	var State = {
		INACTIVE: 1,
		ACTIVE: 2,
		FILTERING: 3
	};
	
	var STYLES = {
		selected : "selected", //$NON-NLS-0$
		hr : "proposal-hr", //$NON-NLS-0$
		emphasis : "proposal-emphasis", //$NON-NLS-0$
		noemphasis : "proposal-noemphasis", //$NON-NLS-0$
		noemphasis_keyword : "proposal-noemphasis-keyword", //$NON-NLS-0$
		noemphasis_title : "proposal-noemphasis-title", //$NON-NLS-0$
		noemphasis_title_keywords : "proposal-noemphasis-title-keywords", //$NON-NLS-0$
		dfault : "proposal-default" //$NON-NLS-0$
	};
	
	function ContentAssist(textView) {
		this.textView = textView;
		this.state = State.INACTIVE;
		this.resetProviderInfoArray();
		var self = this;
		this.contentAssistListener = {
			onModelChanging: (function(event) {
				this._latestModelChangingEvent = event;
			}).bind(this),
			onSelection: (function(event) {
				if (this.isDeactivatingChange(this._latestModelChangingEvent, event)) {
					this.setState(State.INACTIVE);
				} else {
					if (this.isActive()) {
						if (this.state === State.ACTIVE) {
							this.setState(State.FILTERING);
						}
						this.filterProposals(event);
					}
				}
				this._latestModelChangingEvent = null;
			}).bind(this),
			onScroll: (function(event) {
				this.setState(State.INACTIVE);
			}).bind(this)
		};
		
		textView.setKeyBinding(util.isMac ? new mKeyBinding.KeyBinding(' ', false, false, false, true) : new mKeyBinding.KeyBinding(' ', true), "contentAssist"); //$NON-NLS-2$ //$NON-NLS-1$ //$NON-NLS-0$
		textView.setKeyBinding(util.isMac ? new mKeyBinding.KeyBinding(' ', false, false, true, true) : new mKeyBinding.KeyBinding(' ', true, false, true), "contentAssist"); //$NON-NLS-2$ //$NON-NLS-1$ //$NON-NLS-0$
		textView.setAction("contentAssist", function() { //$NON-NLS-0$
			if (!textView.getOptions("readonly")) { //$NON-NLS-0$
				self.activate();
			}
			return true;
		}, {name: messages.contentAssist});
	}
	ContentAssist.prototype = /** @lends orion.editor.ContentAssist.prototype */ {
		/**
		 * Applies the given proposal to the TextView.
		 * @param {Object} [proposal]
		 * @returns {Boolean} <code>true</code> if the proposal was applied; <code>false</code> if no proposal was provided.
		 */
		apply: function(proposal) {
			if (!proposal) {
				return false;
			}
	
			// now handle prefixes
			// if there is a non-empty selection, then replace it,
			// if overwrite is truthy, then also replace the prefix
			var view = this.textView;
			var sel = view.getSelection();
			var start = this._initialCaretOffset;
			var mapStart = start;
			var end = Math.max(sel.start, sel.end), mapEnd = end;
			var model = view.getModel();
			if (model.getBaseModel) {
				mapStart = model.mapOffset(mapStart);
				mapEnd = model.mapOffset(mapEnd);
				model = model.getBaseModel();
			}
			
			if (proposal.overwrite) {
				start = this.getPrefixStart(model, mapStart);
			}

			var data = {
				proposal: proposal,
				start: mapStart,
				end: mapEnd
			};
			this.setState(State.INACTIVE);
			var proposalText = typeof proposal === "string" ? proposal : proposal.proposal; //$NON-NLS-0$
			view.setText(proposalText, start, end);
			this.dispatchEvent({type: "ProposalApplied", data: data}); //$NON-NLS-0$
			return true;
		},
		activate: function(providerInfoArray, autoTriggered) {
			if (this.state === State.INACTIVE) {
				this._autoTriggered = autoTriggered ? true : false;
				this.setState(State.ACTIVE, providerInfoArray);
			}
		},
		deactivate: function() {
			this.setState(State.INACTIVE);
		},
		/** @returns {orion.editor.TextView} */
		getTextView: function() {
			return this.textView;
		},
		/** @returns {Boolean} */
		isActive: function() {
			return this.state === State.ACTIVE || this.state === State.FILTERING;
		},
		/** @returns {Boolean} <code>true</code> if the event describes a change that should deactivate content assist. */
		isDeactivatingChange: function(/**orion.editor.ModelChangingEvent*/ event, selectionEvent) {
			var isDeactivating = false;
			
			var isPriorToInitialCaretOffset = selectionEvent.newValue.start < this._initialCaretOffset;
			
			if (isPriorToInitialCaretOffset) {
				isDeactivating = true;
			} else if (event) {
				isDeactivating = (event.removedLineCount > 0) || (event.addedLineCount > 0);
			}
			
			return isDeactivating;
		},
		/** @private */
		setState: function(state, /* Optional. Array of providers to pass to dispatched event.*/ providerInfoArray) {
			var eventType;
			if (state === State.ACTIVE) {
				this._filterText = "";
				eventType = "Activating"; //$NON-NLS-0$
				if (this._mode) { this._mode.setActive(true); }
				
			} else if (state === State.INACTIVE) {
				eventType = "Deactivating"; //$NON-NLS-0$
				if (this._mode) { this._mode.setActive(false); }
				this._initialCaretOffset = -1;
				this._filterText = "";
			}
			if (eventType) {
				this.dispatchEvent({type: eventType, providerInfoArray: providerInfoArray});
			}
			this.state = state;
			this.onStateChange(state);
		},
		setMode: function(mode) {
			this._mode = mode;
		},
		/** @private */
		onStateChange: function(state) {
			if (state === State.INACTIVE) {
				if (this.listenerAdded) {
					this._latestModelChangingEvent = null;
					this.textView.removeEventListener("ModelChanging", this.contentAssistListener.onModelChanging); //$NON-NLS-0$
					this.textView.removeEventListener("Scroll", this.contentAssistListener.onScroll); //$NON-NLS-0$
					this.textView.removeEventListener("Selection", this.contentAssistListener.onSelection); //$NON-NLS-0$
					this.listenerAdded = false;
				}
			} else if (state === State.ACTIVE) {
				if (!this.listenerAdded) {
					this.textView.addEventListener("ModelChanging", this.contentAssistListener.onModelChanging); //$NON-NLS-0$
					this.textView.addEventListener("Scroll", this.contentAssistListener.onScroll); //$NON-NLS-0$
					this.textView.addEventListener("Selection", this.contentAssistListener.onSelection); //$NON-NLS-0$
					this.listenerAdded = true;
				}
				this.computeProposals();
			}
		},
		/**
		 * Computes the proposals at the TextView's current caret offset.
		 */
		computeProposals: function() {
			var self = this;
			
			// figure out initial offset, it should be the minimum between 
			// the beginning of the selection and the current caret offset
			var offset = this.textView.getCaretOffset();
			var sel = this.textView.getSelection();
			var selectionStart = Math.min(sel.start, sel.end);			
			this._initialCaretOffset = Math.min(offset, selectionStart);
			
			this._computeProposals(this._initialCaretOffset).then(function(proposals) {
				self._computedProposals = proposals;
				if (!self.isActive()) { return; }
				var displayProposals = self._flatten(proposals);
				self.dispatchEvent({type: "ProposalsComputed", data: {proposals: displayProposals}, autoApply: !self._autoTriggered}); //$NON-NLS-0$
			});
		},
		/** @private */
		getPrefixStart: function(model, end) {
			var index = end;
			while (index > 0 && /[A-Za-z0-9_]/.test(model.getText(index - 1, index))) {
				index--;
			}
			return index;
		},
		handleError: function(error) {
			if (typeof console !== "undefined") { //$NON-NLS-0$
				console.log("Error retrieving content assist proposals"); //$NON-NLS-0$
				console.log(error && error.stack);
			}
		},
		/**
		 * Retrieves the proposals at the given offset.
		 * @private
		 * @param {Number} offset The caret offset.
		 * @returns {Deferred} A promise that will provide the proposals.
		 */
		_computeProposals: function(offset) {
			var providerInfoArray = this._providerInfoArray;
			var textView = this.textView;
			var sel = textView.getSelection();
			var model = textView.getModel(), mapOffset = offset;
			if (model.getBaseModel) {
				mapOffset = model.mapOffset(mapOffset);
				sel.start = model.mapOffset(sel.start);
				sel.end = model.mapOffset(sel.end);
				model = model.getBaseModel();
			}
			var line = model.getLine(model.getLineAtOffset(mapOffset));
			var index = 0;
			while (index < line.length && /\s/.test(line.charAt(index))) {
				index++;
			}
			var indentation = line.substring(0, index);
			var options = textView.getOptions("tabSize", "expandTab"); //$NON-NLS-1$ //$NON-NLS-0$
			var tab = options.expandTab ? new Array(options.tabSize + 1).join(" ") : "\t"; //$NON-NLS-1$ //$NON-NLS-0$
			var params = {
				line: line,
				offset: mapOffset,
				prefix: model.getText(this.getPrefixStart(model, mapOffset), mapOffset),
				selection: sel,
				delimiter: model.getLineDelimiter(),
				tab: tab,
				indentation: indentation
			};
			var self = this;
			var promises = providerInfoArray.map(function(providerInfo) {
				var provider = providerInfo.provider;
				var proposals;
				try {
					var func, promise;
					if ((func = provider.computeContentAssist)) {
						var ecProvider = self.editorContextProvider, editorContext = ecProvider.getEditorContext();
						params = objects.mixin(params, ecProvider.getOptions());
						promise = func.apply(provider, [editorContext, params]);
					} else if ((func = provider.getProposals || provider.computeProposals)) {
						// old API
						promise = func.apply(provider, [model.getText(), mapOffset, params]);
					}
					proposals = self.progress ? self.progress.progress(promise, "Generating content assist proposal") : promise; //$NON-NLS-0$
				} catch (e) {
					self.handleError(e);
				}
				return Deferred.when(proposals);
			});
			return Deferred.all(promises, this.handleError);
		},

		filterProposals: function(event) {
			var text = "";
			var removedCharCount = 0;
			if (this._latestModelChangingEvent) {
				text = this._latestModelChangingEvent.text;
				removedCharCount = this._latestModelChangingEvent.removedCharCount;
			} else {
				// the selection was changed but not the model, do nothing for now
				return;
			}
			
			// update this._filterText based on the modification info
			// contained in the event
			if (removedCharCount) {
				var lastIndex = this._filterText.length - removedCharCount;
				this._filterText = this._filterText.substring(0, lastIndex);
			}
			if (text) {
				this._filterText = this._filterText.concat(text);
			}
			
			var model = this.textView.getModel();
			if (model.getBaseModel) {
				model = model.getBaseModel();
			}
			
			var prefixStart = this.getPrefixStart(model, this._initialCaretOffset);
			var prefixText = this.textView.getText(prefixStart, this._initialCaretOffset);
			
			// filter proposals based on prefixes and _filterText
			var proposals = []; //array of arrays of proposals
			this._computedProposals.forEach(function(proposalArray) {
				var includedProposals = proposalArray.filter(function(proposal) {
					if ((STYLES[proposal.style] === STYLES.hr)
						|| (STYLES[proposal.style] === STYLES.noemphasis_title)) {
						return true;
					}
					
					var proposalString = "";
					if (proposal.overwrite) {
						if (proposal.name) {
							proposalString = proposal.name;
						} else if (proposal.proposal) {
							proposalString = proposal.proposal;
						} else {
							return false; // unknown format
						}
	
						return (0 === proposalString.indexOf(prefixText + this._filterText));
						
					} else if (proposal.name || proposal.proposal) {
						var activated = false;
						// try matching name
						if (proposal.name) {
							activated = (0 === proposal.name.indexOf(prefixText + this._filterText));	
						}
						
						// try matching proposal text
						if (!activated && proposal.proposal) {
							activated = (0 === proposal.proposal.indexOf(this._filterText));
						}
						
						return activated;
					} else if (typeof proposal === "string") { //$NON-NLS-0$
						return 0 === proposal.indexOf(this._filterText);
					} else {
						return false;
					}
				}, this);
				
				if (includedProposals.length > 0) {
					proposals.push(includedProposals);	
				}
			}, this);
			
			// filter out extra separators and titles
			proposals = this._removeExtraUnselectableElements(proposals);
			
			var displayProposals = this._flatten(proposals);
			
			this.dispatchEvent({type: "ProposalsComputed", data: {proposals: displayProposals}, autoApply: false}); //$NON-NLS-0$
		},
		
		/**
		 * Helper method which removes extra separators and titles from
		 * an array containing arrays of proposals from the various providers.
		 * @param{Array[]} proposals An array with each element containing an array of proposals
		 */
		_removeExtraUnselectableElements: function(proposals) {
			// get rid of extra separators and titles
			var mappedProposals = proposals.map(function(proposalArray) {
				var element = proposalArray.filter(function(proposal, index) {
					var keepElement = true;
					if (STYLES[proposal.style] === STYLES.hr) {
						if ((0 === index) || ((proposalArray.length - 1) === index)) {
							keepElement = false; // remove separators at first or last element
						} else if (STYLES.hr === STYLES[proposalArray[index - 1].style]) {
							keepElement = false; // remove separator preceeded by another separator
						}
					} else if (STYLES[proposal.style] === STYLES.noemphasis_title) {
						var nextProposal = proposalArray[index + 1];
						if (nextProposal) {
							// remove titles that preceed other titles, all of their subelements have already been filtered out
							if (STYLES[nextProposal.style] === STYLES.noemphasis_title) {
								keepElement = false;
							}
						} else {
							keepElement = false; //remove titles that are at the end of the array
						}
					}
					return keepElement;
				});
				return element;
			});
			
			return mappedProposals;
		},
		
		/**
		 * Sets the provider that will be invoked to generate the Editor Context service and options to any
		 * content assist providers that implement the v4.0 content assist API.
		 * @param {Object} editorContextProvider
		 */
		setEditorContextProvider: function(editorContextProvider) {
			this.editorContextProvider = editorContextProvider;
		},
		
		/**
		 * Helper method used to generate a unique ID for a provider.
		 * Note that the uniqueness of the ID is only guaranteed for the life of this
		 * object and if all of the other IDs are also generated using this method.
		 */
		_generateProviderId: function() {
			if (this._uniqueProviderIdCounter) {
				this._uniqueProviderIdCounter++;
			} else {
				this._uniqueProviderIdCounter = 0;
			}
			return "ContentAssistGeneratedID_" +  this._uniqueProviderIdCounter;
		},
		
		/**
		 * Sets whether or not automatic content assist triggering is enabled.
		 * @param {Boolean} enableAutoTrigger
		 */
		setAutoTriggerEnabled: function(enableAutoTrigger) {
			this._autoTriggerEnabled = enableAutoTrigger;
			this._updateAutoTriggerListenerState();
		},
		
		/**
		 * Sets the content assist providers that this ContentAssist will consult to obtain proposals.
		 * @param {orion.editor.ContentAssistProvider[]} providers The providers.
		 */
		setProviders: function(providers) {
			var providerInfoArray = providers.map(function(provider){
				return {
					provider: provider,
					id: this._generateProviderId()
				}
			}, this);
			
			this.setProviderInfoArray(providerInfoArray);
		},
		
		/**
		 * Sets the array of content assist provider info that this ContentAssist will 
		 * consult to obtain proposals and automatic triggers.
		 * @param {Array { provider: orion.editor.ContentAssistProvider, 
		 * 				   id: {String},
		 * 				   charTriggers: {RegExp},
		 * 				   excludedStyles: {RegExp}
		 * 				  }
		 * 		 } providers The providers.
		 */
		setProviderInfoArray: function(providerInfoArray) {
			this.resetProviderInfoArray();
			
			this._providerInfoArray = providerInfoArray;
			this._charTriggersInstalled = providerInfoArray.some(function(info){
				return info.charTriggers;
			});
			this._updateAutoTriggerListenerState();
		},
		
		resetProviderInfoArray: function() {
			this._providerInfoArray = [];
			this._charTriggersInstalled = false;
			this._updateAutoTriggerListenerState();
		},

		
		/**
		 * Sets the progress handler that will display progress information, if any are generated by content assist providers.
		 */
		setProgress: function(progress){
			this.progress = progress;
		},
		
		setStyleAccessor: function(styleAccessor) {
			this._styleAccessor = styleAccessor;
		},
		
		/**
		 * Flattens an array of arrays into a one-dimensional array.
		 * @param {Array[]} array
		 * @returns {Array}
		 */
		_flatten: function(arrayOrObjectArray) {
			
			return arrayOrObjectArray.reduce(function(prev, curr) {
				var returnValue = prev;
				
				// add current proposal array to flattened array
				// skip current elements that are not arrays
				if (Array.isArray(curr) && curr.length > 0) {		
					var first = curr;
					var last = prev;
					
					if (curr[0].style && (0 === STYLES[curr[0].style].indexOf(STYLES.noemphasis))) {
						// the style of the first element starts with noemphasis
						// add these proposals to the end of the array
						first = prev;
						last = curr;
					}
					
					if (first.length > 0) {
						if (first[first.length - 1].style && (STYLES.hr !== STYLES[first[first.length - 1].style])) {
							// add separator between proposals from different providers 
							// if the previous array didn't already end with a separator
							first = first.concat({
								proposal: '',
								name: '',
								description: '---------------------------------', //$NON-NLS-0$
								style: 'hr', //$NON-NLS-0$
								unselectable: true
							});
						}
					}
					
					returnValue = first.concat(last);
				}
				
				return returnValue;
			}, []);
		},
		
		_triggerListener: function(event) {
			if (this._styleAccessor) {
				var caretOffset = this.textView.getCaretOffset();
				var stylesAtOffset = null;
				var providerInfosToActivate = [];
				
				if (this._charTriggersInstalled) {
					var currentChar = this.textView.getText(caretOffset - 1, caretOffset);
					
					this._providerInfoArray.forEach(function(info) {
						// check if the charTriggers RegExp matches the currentChar
						// we're assuming that this will fail much more often than
						// the excludedStyles test so do this first for better performance
						var charTriggers = info.charTriggers;
						if (charTriggers && charTriggers.test(currentChar)) {
							var isExcluded = false;
							var excludedStyles = info.excludedStyles;
							if (excludedStyles) {
								if (!stylesAtOffset) {
									// lazily initialize this variable to avoid getting the styles
									// for every model modification, only ones that may trigger
									stylesAtOffset = this._styleAccessor.getStyles(caretOffset);
								}
								// check if any of the styles match the excludedStyles RegExp
								isExcluded = stylesAtOffset.some(function (element) {
									return excludedStyles.test(element.style);
								});
							}
							if (!isExcluded) {
								providerInfosToActivate.push(info);
							}
						}
					}, this);
					
					if (providerInfosToActivate.length > 0) {
						this.activate(providerInfosToActivate, true);
					}
				}
			}
		},
		
		/**
		 * Private helper to install/uninstall the automatic trigger
		 * listener based on the state of the relevant booleans
		 */
		_updateAutoTriggerListenerState: function() {
			if (!this._boundTriggerListener) {
				this._boundTriggerListener = this._triggerListener.bind(this);
			}
			
			if (this._triggerListenerInstalled) {
				// uninstall the listener if necessary
				if (!this._autoTriggerEnabled || !this._charTriggersInstalled) {
					this.textView.removeEventListener("Modify", this._boundTriggerListener); //$NON-NLS-0$
					this._triggerListenerInstalled = false;
				}
			} else if (this._autoTriggerEnabled && this._charTriggersInstalled){
				// install the listener if necessary
				this.textView.addEventListener("Modify", this._boundTriggerListener); //$NON-NLS-0$
				this._triggerListenerInstalled = true;
			}
		}
	};
	mEventTarget.EventTarget.addMixin(ContentAssist.prototype);

	/**
	 * @name orion.editor.ContentAssistMode
	 * @class Editor mode for interacting with content assist proposals.
	 * @description Creates a ContentAssistMode. A ContentAssistMode is a key mode for {@link orion.editor.Editor}
	 * that provides interaction with content assist proposals retrieved from an {@link orion.editor.ContentAssist}. 
	 * Interaction is performed via the {@link #lineUp}, {@link #lineDown}, and {@link #enter} actions. An 
	 * {@link orion.editor.ContentAssistWidget} may optionally be provided to display which proposal is currently selected.
	 * @param {orion.editor.ContentAssist} contentAssist
	 * @param {orion.editor.ContentAssistWidget} [ContentAssistWidget]
	 */
	function ContentAssistMode(contentAssist, ContentAssistWidget) {
		var textView = contentAssist.textView;
		mKeyModes.KeyMode.call(this, textView);
		this.contentAssist = contentAssist;
		this.widget = ContentAssistWidget;
		this.proposals = [];
		var self = this;
		this.contentAssist.addEventListener("ProposalsComputed", function(event) { //$NON-NLS-0$
			self.proposals = event.data.proposals;
			if (self.proposals.length === 0) {
				self.selectedIndex = -1;
				self.cancel();
			} else {
				self.selectedIndex = 0;
				while(self.proposals[self.selectedIndex] && self.proposals[self.selectedIndex].unselectable) {
					self.selectedIndex++;
				}
				if (self.proposals[self.selectedIndex]) {
					if (self.widget) {
						var showWidget = true;
						
						if (event.autoApply) {
							var nextIndex = self.selectedIndex + 1;
							while (self.proposals[nextIndex] && self.proposals[nextIndex].unselectable) {
								nextIndex++;
							}
							if (!self.proposals[nextIndex]) {
								// if there is only one selectable proposal apply it automatically
								showWidget = false;
								self.contentAssist.apply(self.proposals[self.selectedIndex]);
							}
						}
						
						if (showWidget) {
							self.widget.show();
							self.widget.selectNode(self.selectedIndex);
						}
					}
				} else {
					self.selectedIndex = -1; // didn't find any selectable items
					self.cancel();
				}
			}
		});
		textView.setAction("contentAssistApply", function() { //$NON-NLS-0$
			return this.enter();
		}.bind(this));
		textView.setAction("contentAssistCancel", function() { //$NON-NLS-0$
			return this.cancel();
		}.bind(this));
		textView.setAction("contentAssistNextProposal", function() { //$NON-NLS-0$
			return this.lineDown();
		}.bind(this));
		textView.setAction("contentAssistPreviousProposal", function() { //$NON-NLS-0$
			return this.lineUp();
		}.bind(this));
		textView.setAction("contentAssistNextPage", function() { //$NON-NLS-0$
			return this.pageDown();
		}.bind(this));
		textView.setAction("contentAssistPreviousPage", function() { //$NON-NLS-0$
			return this.pageUp();
		}.bind(this));
		textView.setAction("contentAssistHome", function() { //$NON-NLS-0$
			if (this.widget) {
				this.widget.scrollIndex(0, true);
			}
			return this.lineDown(0); // select first selectable element starting at the top and moving downwards
		}.bind(this));
		textView.setAction("contentAssistEnd", function() { //$NON-NLS-0$
			return this.lineUp(this.proposals.length - 1); // select first selectable element starting at the bottom and moving up
		}.bind(this));
		textView.setAction("contentAssistTab", function() { //$NON-NLS-0$
			return this.tab();
		}.bind(this));
		
		if (this.widget) {
			this.widget.setContentAssistMode(this);
		}
	}
	ContentAssistMode.prototype = new mKeyModes.KeyMode();
	objects.mixin(ContentAssistMode.prototype, {
		createKeyBindings: function() {
			var KeyBinding = mKeyBinding.KeyBinding;
			var bindings = [];
			bindings.push({actionID: "contentAssistApply", keyBinding: new KeyBinding(13)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistCancel", keyBinding: new KeyBinding(27)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistNextProposal", keyBinding: new KeyBinding(40)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistPreviousProposal", keyBinding: new KeyBinding(38)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistNextPage", keyBinding: new KeyBinding(34)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistPreviousPage", keyBinding: new KeyBinding(33)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistHome", keyBinding: new KeyBinding(lib.KEY.HOME)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistEnd", keyBinding: new KeyBinding(lib.KEY.END)}); //$NON-NLS-0$
			bindings.push({actionID: "contentAssistTab", keyBinding: new KeyBinding(9)}); //$NON-NLS-0$
			return bindings;
		},
		cancel: function() {
			this.getContentAssist().deactivate();
		},
		/** @private */
		getContentAssist: function() {
			return this.contentAssist;
		},
		getProposals: function() {
			return this.proposals;	
		},
		isActive: function() {
			return this.getContentAssist().isActive();
		},
		setActive: function(active) {
			if (active) {
				this.contentAssist.textView.addKeyMode(this);
			} else {
				this.contentAssist.textView.removeKeyMode(this);
			}
		},
		/**
		 * Selects a selectable item in the content assist widget
		 * iterating backwards for .
		 * 
		 * @param index {number} Optional. The index of the item to try and select. 
		 */
		lineUp: function(index, noWrap) {
			return this.selectNew(index, noWrap, false);
		},
		/**
		 * Selects the item at the specified index or the next
		 * selectable item
		 */
		lineDown: function(index, noWrap) {
			return this.selectNew(index, noWrap, true);
		},
		selectNew: function(index, noWrap, forward) {
			var newIndex = index;
			
			if (forward) {
				if (undefined === newIndex) {
					newIndex = this.selectedIndex + 1;
				}
				// handle wrap around
				if (newIndex >= this.proposals.length) {
					if (noWrap) {
						return true; // do nothing
					} else {
						newIndex = 0;	
					}
				}
			} else {
				if (undefined === newIndex) {
					newIndex = this.selectedIndex - 1;
				}
				// handle wrap around
				if (0 > newIndex) {
					if (noWrap) {
						return true; // do nothing
					} else {
						newIndex = this.proposals.length - 1;	
					}
				}
			}
			
			var startIndex = newIndex;
			while (this.proposals[newIndex] && this.proposals[newIndex].unselectable) {
				if (forward) {
					newIndex++;
					// handle wrap around
					if (newIndex >= this.proposals.length) {
						if (noWrap) {
							return true; // do nothing
						} else {
							newIndex = 0;	
						}
					}
				} else {
					newIndex--;
					// handle wrap around
					if (0 > newIndex) {
						if (noWrap) {
							return true; // do nothing
						} else {
							newIndex = this.proposals.length - 1;	
						}
					}
				}
				
				if (newIndex === startIndex) {
					// looped through all nodes and didn't find any that were selectable
					newIndex = -1;
					break;
				}
			}
			
			this.selectedIndex = newIndex;
			
			if (this.widget) {
				this.widget.selectNode(newIndex);
			}
			return true;
		},
		
		pageUp: function() {
			//TODO find out why this doesn't always go to the very top
			if (this.widget) {
				var newSelected = this.widget.getTopIndex();
				if (newSelected === this.selectedIndex) {
					this.widget.scrollIndex(newSelected, false);
					newSelected = this.widget.getTopIndex();
				}
				if (0 === newSelected) {
					// if we're attempting to select the first item in the list
					// move down to the next one if it is not selectable
					return this.lineDown(newSelected, true);	
				}
				return this.lineUp(newSelected, true);
			} else {
				return this.lineUp();
			}
		},
		pageDown: function() {
			if (this.widget) {
				var newSelected = this.widget.getBottomIndex();
				if (newSelected === this.selectedIndex) {
					this.widget.scrollIndex(newSelected, true);
					newSelected = this.widget.getBottomIndex();
				}
				return this.lineDown(newSelected, true);
			} else {
				return this.lineDown();
			}
		},
		enter: function() {
			var proposal = this.proposals[this.selectedIndex] || null;
			return this.contentAssist.apply(proposal);
		},
		tab: function() {
			if (this.widget) {
				this.widget.createAccessible(this);
				this.widget.parentNode.focus();
				return true;
			} else {
				return false;
			}
		}
	});

	/**
	 * @name orion.editor.ContentAssistWidget
	 * @class Displays proposals from a {@link orion.editor.ContentAssist}.
	 * @description Creates a ContentAssistWidget that will display proposals from the given {@link orion.editor.ContentAssist}
	 * in the given <code>parentNode</code>. Clicking a proposal will cause the ContentAssist to apply that proposal.
	 * @param {orion.editor.ContentAssist} contentAssist
	 * @param {String|DomNode} [parentNode] The ID or DOM node to use as the parent for displaying proposals. If not provided,
	 * a new DIV will be created inside &lt;body&gt; and assigned the CSS class <code>contentassist</code>.
	 */
	function ContentAssistWidget(contentAssist, parentNode) {
		this.contentAssist = contentAssist;
		this.textView = this.contentAssist.getTextView();
		this.textViewListenerAdded = false;
		this.isShowing = false;
		var document = this.textView.getOptions("parent").ownerDocument; //$NON-NLS-0$
		this.parentNode = typeof parentNode === "string" ? document.getElementById(parentNode) : parentNode; //$NON-NLS-0$
		if (!this.parentNode) {
			this.parentNode = util.createElement(document, "div"); //$NON-NLS-0$
			this.parentNode.className = "contentassist"; //$NON-NLS-0$
			var body = document.getElementsByTagName("body")[0]; //$NON-NLS-0$
			if (body) {
				body.appendChild(this.parentNode);
			} else {
				throw new Error("parentNode is required"); //$NON-NLS-0$
			}
		}
		var self = this;
		this.textViewListener = {
			onMouseDown: function(event) {
				var target = event.event.target || event.event.srcElement;
				if (target.parentElement !== self.parentNode) {
					self.contentAssist.deactivate();
				}
				// ignore the event if this is a click inside of the parentNode
				// the click is handled by the onClick() function
			}
		};
		this.contentAssist.addEventListener("Deactivating", function(event) { //$NON-NLS-0$
			self.hide();
		});
		this.scrollListener = function(e) {
			if (self.isShowing) {
				self.position();
			}
		};
		textUtil.addEventListener(document, "scroll", this.scrollListener); //$NON-NLS-0$
	}
	ContentAssistWidget.prototype = /** @lends orion.editor.ContentAssistWidget.prototype */ {
		/** @private */
		onClick: function(e) {
			if (!e) { e = window.event; }
			this.contentAssist.apply(this.getProposal(e.target || e.srcElement));
			this.textView.focus();
		},
		/** @private */
		createDiv: function(proposal, parent, itemIndex) {
			var document = parent.ownerDocument;
			var div = util.createElement(document, "div"); //$NON-NLS-0$
			div.id = "contentoption" + itemIndex; //$NON-NLS-0$
			div.setAttribute("role", "option"); //$NON-NLS-1$ //$NON-NLS-0$
			div.className = STYLES[proposal.style] ? STYLES[proposal.style] : STYLES.dfault;
			var node;
			if (proposal.style === "hr") { //$NON-NLS-0$
				node = util.createElement(document, "hr"); //$NON-NLS-0$
			} else {
				node = this._createDisplayNode(div, proposal, itemIndex);
				div.contentAssistProposalIndex = itemIndex; // make div clickable
			}
			div.appendChild(node);
			parent.appendChild(div);
		},
		/** @private */
		createAccessible: function(mode) {
			if(!this._isAccessible) {
				textUtil.addEventListener(this.parentNode, "keydown", function(evt) { //$NON-NLS-0$
					if (!evt) { evt = window.event; }
					if(evt.keyCode === 27) {return mode.cancel(); }
					else if(evt.keyCode === 38) { return mode.lineUp(); }
					else if(evt.keyCode === 40) { return mode.lineDown(); }
					else if(evt.keyCode === 13) { return mode.enter(); }
					if (evt.preventDefault) {
						evt.preventDefault();
					} else {
						evt.cancelBubble = true;
						evt.returnValue = false;
						evt.keyCode = 0;
					}
					return false;
				});
			}
			this._isAccessible = true;
		},
		/** @private */
		_createDisplayNode: function(div, proposal, index) {
			var node = null;
			var plainString = null;
			
			if (typeof proposal === "string") { //$NON-NLS-0$
				//for simple string content assist, the display string is just the proposal
				plainString = proposal;
			} else if (proposal.description && typeof proposal.description === "string") { //$NON-NLS-0$
				if (proposal.name && typeof proposal.name === "string") { //$NON-NLS-0$
					var nameNode = this._createNameNode(proposal.name);
					nameNode.contentAssistProposalIndex = index;
					
					node = document.createElement("span"); //$NON-NLS-0$
					node.appendChild(nameNode);
					
					var descriptionNode = document.createTextNode(proposal.description);
					node.appendChild(descriptionNode);
					div.setAttribute("title", proposal.name + proposal.description); //$NON-NLS-0$
				} else {
					plainString = proposal.description;
				}
			} else {
				//by default return the straight proposal text
				plainString = proposal.proposal;
			}
			
			if (plainString) {
				node = this._createNameNode(plainString);
				div.setAttribute("title", plainString); //$NON-NLS-0$
			}
			
			node.contentAssistProposalIndex = index;
			
			return node;
		},
		/** @private */
		_createNameNode: function(name) {
			var node = document.createElement("span"); //$NON-NLS-0$
			node.classList.add("proposal-name"); //$NON-NLS-0$
			node.appendChild(document.createTextNode(name));
			return node;
		},
		/**
		 * @private
		 * @returns {Object} The proposal represented by the given node.
		 */
		getProposal: function(/**DOMNode*/ node) {
			var proposal = null;
			
			var nodeIndex = node.contentAssistProposalIndex;
			
			if (undefined !== nodeIndex){
				proposal = this._contentAssistMode.getProposals()[nodeIndex] || null;
			}
			
			return proposal;
		},
		/** @private */
		getTopIndex: function() {
			var nodes = this.parentNode.childNodes;
			for (var i=0; i < nodes.length; i++) {
				var child = nodes[i];
				if (child.offsetTop >= this.parentNode.scrollTop) {
					return i;
				}
			}
			return 0;
		},
		/** @private */
		getBottomIndex: function() {
			var nodes = this.parentNode.childNodes;
			for (var i=0; i < nodes.length; i++) {
				var child = nodes[i];
				if ((child.offsetTop + child.offsetHeight) > (this.parentNode.scrollTop + this.parentNode.clientHeight)) {
					return Math.max(0, i - 1);
				}
			}
			return nodes.length - 1;
		},
		/** @private */
		scrollIndex: function(index, top) {
			this.parentNode.childNodes[index].scrollIntoView(top);
		},
		/**
		 * Visually selects the node at the specified nodeIndex
		 * by updating its CSS class and scrolling it into view
		 * if necessary.
		 * @param{Number} nodeIndex The index of the node to select
		 */
		selectNode: function(nodeIndex) {
			var node = null;
			
			if (this.previousSelectedNode) {
				this.previousSelectedNode.classList.remove(STYLES.selected);
			}
			
			if (-1 !== nodeIndex) {
				node = this.parentNode.childNodes[nodeIndex];
				node.classList.add(STYLES.selected);
				this.parentNode.setAttribute("aria-activedescendant", node.id); //$NON-NLS-0$
				node.focus();
				if (node.offsetTop < this.parentNode.scrollTop) {
					node.scrollIntoView(true);
				} else if ((node.offsetTop + node.offsetHeight) > (this.parentNode.scrollTop + this.parentNode.clientHeight)) {
					node.scrollIntoView(false);
				}
			}
			
			this.previousSelectedNode = node;
		},
		setContentAssistMode: function(mode) {
			this._contentAssistMode = mode;
		},
		show: function() {
			var proposals = this._contentAssistMode.getProposals();
			if (proposals.length === 0) {
				this.hide();
			} else {
				this.parentNode.innerHTML = "";
				for (var i = 0; i < proposals.length; i++) {
					this.createDiv(proposals[i], this.parentNode, i);
				}
				this.position();
				this.parentNode.onclick = this.onClick.bind(this);
				this.isShowing = true;
				
				if (!this.textViewListenerAdded) {
					this.textView.addEventListener("MouseDown", this.textViewListener.onMouseDown); //$NON-NLS-0$
					this.textViewListenerAdded = true;
				}
			}
		},
		hide: function() {
			if(this.parentNode.ownerDocument.activeElement === this.parentNode) {
				this.textView.focus();
			}
			this.parentNode.style.display = "none"; //$NON-NLS-0$
			this.parentNode.onclick = null;
			this.isShowing = false;
			
			if (this.textViewListenerAdded) {
				this.textView.removeEventListener("MouseDown", this.textViewListener.onMouseDown); //$NON-NLS-0$
				this.textViewListenerAdded = false;
			}
		},
		position: function() {
			var contentAssist = this.contentAssist;
			var offset;
			var view = this.textView;
			if (contentAssist.offset !== undefined) {
				offset = contentAssist.offset;
				var model = view.getModel();
				if (model.getBaseModel) {
					offset = model.mapOffset(offset, true);
				}
			} else {
				offset = this.textView.getCaretOffset();
			}
			var caretLocation = view.getLocationAtOffset(offset);
			caretLocation.y += view.getLineHeight();
			this.textView.convert(caretLocation, "document", "page"); //$NON-NLS-1$ //$NON-NLS-0$
			this.parentNode.style.position = "fixed"; //$NON-NLS-0$
			this.parentNode.style.left = caretLocation.x + "px"; //$NON-NLS-0$
			this.parentNode.style.top = caretLocation.y + "px"; //$NON-NLS-0$
			this.parentNode.style.display = "block"; //$NON-NLS-0$
			this.parentNode.scrollTop = 0;

			// Make sure that the panel is never outside the viewport
			var document = this.parentNode.ownerDocument;
			var viewportWidth = document.documentElement.clientWidth,
			    viewportHeight =  document.documentElement.clientHeight;
			if (caretLocation.y + this.parentNode.offsetHeight > viewportHeight) {
				this.parentNode.style.top = (caretLocation.y - this.parentNode.offsetHeight - this.textView.getLineHeight()) + "px"; //$NON-NLS-0$
			}
			if (caretLocation.x + this.parentNode.offsetWidth > viewportWidth) {
				this.parentNode.style.left = (viewportWidth - this.parentNode.offsetWidth) + "px"; //$NON-NLS-0$
			}
		}
	};
	return {
		ContentAssist: ContentAssist,
		ContentAssistMode: ContentAssistMode,
		ContentAssistWidget: ContentAssistWidget
	};
});
