// src/features/Market/MarketTree.jsx
import { useEffect, useState } from 'react';
import './MarketTree.css';

const TREE_STATE_KEY = "marketTreeState";
const SELECTED_ITEM_KEY = "selectedItemID";

function MarketTreeNode({
    node,
    nodeName,
    path,
    onItemSelect,
    expandedNodes,
    toggleNode,
}) {
    const currentPath = [...path, nodeName];
    const nodeKey = currentPath.join('/');
    const isOpen = expandedNodes.has(nodeKey);
    const hasSubgroups = Object.keys(node).some(
        (key) => !['_info', 'items', 'name'].includes(key)
    );
    const hasItems = Array.isArray(node.items) && node.items.length > 0;

    return (
        <li>
            <div className="tree-group-header" onClick={() => toggleNode(nodeKey)}>
                {node._info?.iconFile && (
                    <img
                        src={
                            node._info?.iconFile
                                ? `${import.meta.env.BASE_URL}assets/marketGroupIcons/${node._info.iconFile}`
                                : `${import.meta.env.BASE_URL}assets/marketGroupIcons/defaultGroupIcon.png`
                        }
                        alt=""
                        className="group-icon"
                        onError={(e) => {
                            e.target.onerror = null; // Prevent infinite loop
                            e.target.src = `${import.meta.env.BASE_URL}assets/marketGroupIcons/defaultGroupIcon.png`;
                        }}
                    />
                )}
                {nodeName}
            </div>

            {isOpen && (
                <>
                    {hasItems && (
                        <ul>
                            {node.items.map((item) => (
                                <li key={item.typeID} className="market-item with-button">
                                    <span
                                        id={`item-${item.typeID}`} // Unique scroll target
                                        className="item-name"
                                        onClick={() => {
                                            localStorage.setItem(SELECTED_ITEM_KEY, item.typeID);
                                            onItemSelect?.(item);
                                        }}
                                    >
                                        {item.typeName}
                                    </span>


                                    <button
                                        className="quickbar-add-btn"
                                        title="Add to Quickbar"
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent triggering the item selection
                                            window.dispatchEvent(new CustomEvent("quickbar:add", {
                                                detail: {
                                                    typeID: item.typeID,
                                                    typeName: item.typeName,
                                                    groupID: item.groupID,
                                                    categoryID: item.categoryID
                                                }
                                            }));
                                        }}
                                    >
                                        +
                                    </button>
                                </li>
                            ))}

                        </ul>
                    )}

                    {hasSubgroups && (
                        <ul>
                            {Object.entries(node).map(([childKey, childValue]) => {
                                if (childKey === '_info' || childKey === 'items' || childKey === 'name') return null;
                                return (
                                    <MarketTreeNode
                                        key={[...currentPath, childKey].join('/')}
                                        node={childValue}
                                        nodeName={childKey}
                                        path={currentPath}
                                        onItemSelect={onItemSelect}
                                        expandedNodes={expandedNodes}
                                        toggleNode={toggleNode}
                                    />
                                );
                            })}
                        </ul>
                    )}
                </>
            )}
        </li>
    );
}

export default function MarketTree({ marketTree, onItemSelect, breadcrumbPath, collapseVersion }) {
    const [expandedNodes, setExpandedNodes] = useState(new Set());

    useEffect(() => {
        const saved = localStorage.getItem(TREE_STATE_KEY);
        if (saved) {
            try {
                setExpandedNodes(new Set(JSON.parse(saved)));
            } catch (err) {
                console.warn("Could not parse tree state", err);
            }
        }
    }, []);

    // Reset expansion state when collapseVersion changes
    useEffect(() => {
        if (collapseVersion !== undefined) {
            setExpandedNodes(new Set());
            localStorage.setItem(TREE_STATE_KEY, JSON.stringify([]));
        }
    }, [collapseVersion]);

    useEffect(() => {
        localStorage.setItem(TREE_STATE_KEY, JSON.stringify([...expandedNodes]));
    }, [expandedNodes]);

    // Handle breadcrumb navigation - expand nodes along the path
    useEffect(() => {
        if (breadcrumbPath && breadcrumbPath.length > 0) {
            setExpandedNodes((prev) => {
                const updated = new Set(prev);
                // Build all the paths we need to expand
                for (let i = 0; i < breadcrumbPath.length; i++) {
                    const pathSegment = breadcrumbPath.slice(0, i + 1).join('/');
                    updated.add(pathSegment);
                }
                return updated;
            });
        }
    }, [breadcrumbPath]);

    function toggleNode(nodeKey) {
        setExpandedNodes((prev) => {
            const updated = new Set(prev);
            updated.has(nodeKey) ? updated.delete(nodeKey) : updated.add(nodeKey);
            return updated;
        });
    }

    function handleBreadcrumbNavigation(breadcrumbSegments) {
        // Expand all nodes in the breadcrumb path
        setExpandedNodes((prev) => {
            const updated = new Set(prev);
            for (let i = 0; i < breadcrumbSegments.length; i++) {
                const pathSegment = breadcrumbSegments.slice(0, i + 1).join('/');
                updated.add(pathSegment);
            }
            return updated;
        });
    }

    // Expose the breadcrumb navigation handler to parent components
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.marketTreeNavigate = handleBreadcrumbNavigation;
        }
    }, []);

    useEffect(() => {
        if (!breadcrumbPath || breadcrumbPath.length === 0 || !marketTree) return;

        const selectedItemID = localStorage.getItem(SELECTED_ITEM_KEY);
        if (!selectedItemID) return;

        // Wait for DOM to update, then scroll
        setTimeout(() => {
            const el = document.getElementById(`item-${selectedItemID}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100); // Delay slightly to wait for expanded content to render
    }, [breadcrumbPath, marketTree]);


    if (!marketTree) return null;

    return (
        <ul className="menuList menuListtop">
            {marketTree.map((node, idx) => (
                <MarketTreeNode
                    key={node.name || idx}
                    node={node}
                    nodeName={node.name}
                    path={[]}
                    onItemSelect={onItemSelect}
                    expandedNodes={expandedNodes}
                    toggleNode={toggleNode}
                />
            ))}
        </ul>
    );
}